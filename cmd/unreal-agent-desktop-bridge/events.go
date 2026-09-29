package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

// eventLog is a durable, renderer-oriented projection. Session store items remain
// canonical; reconcile repairs a missing projection entry after a crash.
type eventLog struct {
	mu        sync.Mutex
	dir       string
	output    *output
	state     map[session.ID]*eventState
	outcomes  map[session.ID]*lifecycle
	queueMu   sync.Mutex
	queueCond *sync.Cond
	queue     []queuedEvent
}

type queuedEvent struct {
	id        session.ID
	kind      string
	payload   any
	at        time.Time
	transient bool
	barrier   chan struct{}
}

type eventState struct {
	next       uint64
	source     map[uint64]struct{}
	contiguous uint64
}

func newEventLog(dir string, out *output) (*eventLog, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	log := &eventLog{dir: dir, output: out, state: make(map[session.ID]*eventState)}
	log.queueCond = sync.NewCond(&log.queueMu)
	go log.writeQueue()
	return log, nil
}

// enqueue keeps telemetry and UI observation off the coordinator's critical path.
func (l *eventLog) enqueue(id session.ID, kind string, payload any) {
	l.queueMu.Lock()
	l.queue = append(l.queue, queuedEvent{id: id, kind: kind, payload: payload, at: time.Now().UTC()})
	l.queueCond.Signal()
	l.queueMu.Unlock()
}

// A transient preview is delivered live but never written to the replay log.
// Drop excess previews rather than letting UI presentation delay model work.
func (l *eventLog) preview(id session.ID, kind string, payload any) {
	l.queueMu.Lock()
	if len(l.queue) < 1024 {
		l.queue = append(l.queue, queuedEvent{id: id, kind: kind, payload: payload, at: time.Now().UTC(), transient: true})
		l.queueCond.Signal()
	}
	l.queueMu.Unlock()
}

func (l *eventLog) writeQueue() {
	for {
		l.queueMu.Lock()
		for len(l.queue) == 0 {
			l.queueCond.Wait()
		}
		value := l.queue[0]
		l.queue[0] = queuedEvent{}
		l.queue = l.queue[1:]
		l.queueMu.Unlock()
		if value.barrier != nil {
			close(value.barrier)
			continue
		}
		if value.transient {
			payload, err := json.Marshal(value.payload)
			if err == nil {
				_ = l.output.write(event{Version: protocolVersion, Event: value.kind, SessionID: string(value.id), RecordedAt: value.at, Payload: jsontext.Value(payload)})
			}
			continue
		}
		if err := l.appendAt(value.id, value.kind, value.payload, 0, value.at); err != nil {
			fmt.Fprintln(os.Stderr, "write telemetry:", err)
		}
	}
}

func (l *eventLog) flush() {
	done := make(chan struct{})
	l.queueMu.Lock()
	l.queue = append(l.queue, queuedEvent{barrier: done})
	l.queueCond.Signal()
	l.queueMu.Unlock()
	<-done
}

func (l *eventLog) path(id session.ID) string {
	return filepath.Join(l.dir, string(id)+".jsonl")
}

// A crash can leave only the final JSONL record incomplete. Preserve those
// bytes privately before removing that one fragment; complete records and the
// canonical session store remain untouched.
func (l *eventLog) repairTailLocked(id session.ID) error {
	path := l.path(id)
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		return err
	}
	last := []byte{0}
	if _, err := f.ReadAt(last, info.Size()-1); err != nil {
		return err
	}
	if last[0] == '\n' {
		return nil
	}
	const maxTail = 16 * 1024 * 1024
	start := max(int64(0), info.Size()-maxTail)
	part := make([]byte, info.Size()-start)
	if _, err := f.ReadAt(part, start); err != nil {
		return err
	}
	boundary := bytes.LastIndexByte(part, '\n')
	if boundary < 0 && start > 0 {
		return errors.New("activity log tail exceeds recovery limit")
	}
	tailStart := start + int64(boundary+1)
	tail := part[boundary+1:]
	var entry event
	if json.Unmarshal(tail, &entry) == nil && entry.Version == protocolVersion && entry.SessionID == string(id) && entry.Sequence > 0 {
		if _, err := f.WriteAt([]byte{'\n'}, info.Size()); err != nil {
			return err
		}
		return f.Sync()
	}
	backup := path + ".partial-" + uuid.New().String()
	if err := os.WriteFile(backup, tail, 0o600); err != nil {
		return err
	}
	if err := f.Truncate(tailStart); err != nil {
		return err
	}
	return f.Sync()
}

func (l *eventLog) readLocked(id session.ID) ([]event, error) {
	if err := l.repairTailLocked(id); err != nil {
		return nil, err
	}
	f, err := os.Open(l.path(id))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var entries []event
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var entry event
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			return nil, fmt.Errorf("decode activity log: %w", err)
		}
		entries = append(entries, entry)
	}
	return entries, scanner.Err()
}

func (l *eventLog) append(id session.ID, kind string, payload any, sourceSequence uint64) error {
	return l.appendAt(id, kind, payload, sourceSequence, time.Now().UTC())
}

func (l *eventLog) appendAt(id session.ID, kind string, payload any, sourceSequence uint64, at time.Time) error {
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	life, err := l.lifecycleLocked(id)
	if err != nil {
		return err
	}
	state := l.state[id]
	if state == nil {
		entries, err := l.readLocked(id)
		if err != nil {
			return err
		}
		state = &eventState{next: uint64(len(entries) + 1), source: make(map[uint64]struct{})}
		for _, entry := range entries {
			if entry.SourceSequence != 0 {
				state.source[entry.SourceSequence] = struct{}{}
			}
		}
		for {
			if _, ok := state.source[state.contiguous+1]; !ok {
				break
			}
			state.contiguous++
		}
		l.state[id] = state
	}
	if sourceSequence != 0 {
		if _, exists := state.source[sourceSequence]; exists {
			return nil
		}
	}
	var projected map[string]any
	if err := json.Unmarshal(encodedPayload, &projected); err != nil {
		return err
	}
	// Apply only after the write commits; retries must not advance the projection.
	nextLife := life
	if kind == "session.idle" || kind == "session.status" || kind == "verification.result" {
		copyBytes, _ := json.Marshal(life)
		nextLife = new(lifecycle)
		_ = json.Unmarshal(copyBytes, nextLife)
		nextLife.consume(kind, projected, at)
		projected["outcome"] = nextLife.Outcome
		encodedPayload, _ = json.Marshal(projected)
	}
	entry := event{Version: protocolVersion, Event: kind, SessionID: string(id), Sequence: state.next, SourceSequence: sourceSequence, RecordedAt: at, Payload: jsontext.Value(encodedPayload)}
	line, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(l.path(id), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := fmt.Fprintf(f, "%s\n", line)
	if writeErr == nil {
		writeErr = f.Sync()
	}
	closeErr := f.Close()
	if writeErr != nil {
		delete(l.state, id)
		delete(l.outcomes, id)
		return writeErr
	}
	if closeErr != nil {
		delete(l.state, id)
		delete(l.outcomes, id)
		return closeErr
	}
	state.next++
	if kind != "session.idle" && kind != "session.status" && kind != "verification.result" {
		nextLife.consume(kind, projected, at)
	}
	l.outcomes[id] = nextLife
	if kind == "session.idle" || kind == "session.status" || kind == "verification.result" {
		l.saveLifecycleLocked(id, nextLife)
	}
	if sourceSequence != 0 {
		state.source[sourceSequence] = struct{}{}
		for {
			if _, ok := state.source[state.contiguous+1]; !ok {
				break
			}
			state.contiguous++
		}
	}
	return l.output.write(entry)
}

func (l *eventLog) reconcile(store sessionstore.Store, id session.ID) error {
	l.mu.Lock()
	state := l.state[id]
	if state == nil {
		entries, err := l.readLocked(id)
		if err != nil {
			l.mu.Unlock()
			return err
		}
		state = &eventState{next: uint64(len(entries) + 1), source: make(map[uint64]struct{})}
		for _, entry := range entries {
			if entry.SourceSequence != 0 {
				state.source[entry.SourceSequence] = struct{}{}
			}
		}
		for {
			if _, ok := state.source[state.contiguous+1]; !ok {
				break
			}
			state.contiguous++
		}
		l.state[id] = state
	}
	after := sessionstore.Sequence(state.contiguous)
	l.mu.Unlock()
	for {
		page, err := store.Items(context.Background(), id, after, 256)
		if err != nil {
			return err
		}
		for _, item := range page.Items {
			if err := l.append(id, "session.item", projectItem(item), uint64(item.Sequence)); err != nil {
				return err
			}
		}
		if !page.More {
			return nil
		}
		after = page.NextAfter
	}
}

// Provider-private raw reasoning and usage envelopes belong in the canonical
// session store, not the renderer's activity projection.
func projectItem(item sessionstore.Item) sessionstore.Item {
	if item.Kind != sessionstore.ItemModelResponse {
		return item
	}
	value, ok := item.Data.(sessionstore.ModelResponse)
	if !ok {
		return item
	}
	value.Response.Usage.Raw = nil
	value.Response.Output = append([]llm.Item(nil), value.Response.Output...)
	for index, output := range value.Response.Output {
		if output.Type != llm.ItemReasoning {
			continue
		}
		reasoning, ok := output.Data.(llm.Reasoning)
		if !ok {
			continue
		}
		reasoning.Raw = nil
		value.Response.Output[index].Data = reasoning
	}
	item.Data = value
	return item
}

func (l *eventLog) entries(id session.ID, after uint64, limit int) ([]event, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	all, err := l.readLocked(id)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 1000 {
		limit = 500
	}
	if after >= uint64(len(all)) {
		return []event{}, nil
	}
	end := min(int(after)+limit, len(all))
	return all[after:end], nil
}

// Retain only the latest renderer window; original events remain on disk.
func (l *eventLog) latest(id session.ID, limit int) ([]event, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if limit < 1 || limit > 3000 {
		limit = 3000
	}
	if err := l.repairTailLocked(id); err != nil {
		return nil, err
	}
	f, err := os.Open(l.path(id))
	if errors.Is(err, fs.ErrNotExist) {
		return []event{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	ring := make([]event, limit)
	count := 0
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var value event
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			return nil, err
		}
		ring[count%limit] = value
		count++
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if count <= limit {
		return ring[:count], nil
	}
	start := count % limit
	return append(ring[start:], ring[:start]...), nil
}
