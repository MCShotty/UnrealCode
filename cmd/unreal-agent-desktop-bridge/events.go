package main

import (
	"bufio"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

// eventLog is a durable, renderer-oriented projection. Session store items remain
// canonical; reconcile repairs a missing projection entry after a crash.
type eventLog struct {
	mu     sync.Mutex
	dir    string
	output *output
	state  map[session.ID]*eventState
}

type eventState struct {
	next   uint64
	source map[uint64]struct{}
}

func newEventLog(dir string, out *output) (*eventLog, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &eventLog{dir: dir, output: out, state: make(map[session.ID]*eventState)}, nil
}

func (l *eventLog) path(id session.ID) string {
	return filepath.Join(l.dir, string(id)+".jsonl")
}

func (l *eventLog) readLocked(id session.ID) ([]event, error) {
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
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
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
		l.state[id] = state
	}
	if sourceSequence != 0 {
		if _, exists := state.source[sourceSequence]; exists {
			return nil
		}
	}
	entry := event{Version: protocolVersion, Event: kind, SessionID: string(id), Sequence: state.next, SourceSequence: sourceSequence, Payload: jsontext.Value(encodedPayload)}
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
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	state.next++
	if sourceSequence != 0 {
		state.source[sourceSequence] = struct{}{}
	}
	return l.output.write(entry)
}

func (l *eventLog) reconcile(store sessionstore.Store, id session.ID) error {
	var after sessionstore.Sequence
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
