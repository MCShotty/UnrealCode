// Command unreal-agent-desktop-bridge keeps Unreal Agent sessions alive and
// accepts versioned JSONL requests from a local desktop process over stdio.
package main

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}
type cancelOperationParams struct {
	SessionID   string `json:"sessionId"`
	OperationID string `json:"operationId"`
}
type createParams struct {
	Config     sessionConfig `json:"config"`
	Credential credential    `json:"credential"`
}
type openParams struct {
	SessionID  string     `json:"sessionId"`
	Credential credential `json:"credential"`
}
type sendParams struct {
	SessionID  string     `json:"sessionId"`
	MessageID  string     `json:"messageId"`
	Prompt     string     `json:"prompt"`
	Credential credential `json:"credential"`
}
type historyParams struct {
	SessionID string `json:"sessionId"`
	After     uint64 `json:"after"`
	Limit     int    `json:"limit"`
}
type forkParams struct {
	SessionID  string     `json:"sessionId"`
	Credential credential `json:"credential"`
}
type installDecisionParams struct {
	Engine string `json:"engine"`
}
type extractParams struct {
	Text   string   `json:"text"`
	Labels []string `json:"labels"`
}

func requiredID(value string) (session.ID, error) {
	if _, err := uuid.Parse(value); err != nil {
		return "", errors.New("invalid session ID")
	}
	return session.ID(value), nil
}

func (a *app) dispatch(req request) (any, error) {
	if req.Version != protocolVersion {
		return nil, fmt.Errorf("unsupported protocol version %d", req.Version)
	}
	switch req.Method {
	case "context.configure":
		p, err := decodeParams[struct {
			Excluded []string `json:"excluded"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		if err := a.preferences.configure(p.Excluded); err != nil {
			return nil, err
		}
		return map[string]bool{"configured": true}, nil
	case "project.idle":
		a.mu.Lock()
		defer a.mu.Unlock()
		for _, run := range a.running {
			if run.busy.Load() || run.stopping.Load() {
				return false, nil
			}
		}
		return true, nil
	case "health":
		return map[string]any{"ready": true, "workspace": "/workspace", "version": protocolVersion}, nil
	case "decision.configure":
		config, err := decodeParams[decisionConfig](req.Params)
		if err != nil {
			return nil, err
		}
		if err := a.decision.configure(config); err != nil {
			return nil, err
		}
		return a.decision.status(), nil
	case "decision.status":
		return a.decision.status(), nil
	case "decision.install":
		params, err := decodeParams[installDecisionParams](req.Params)
		if err != nil {
			return nil, err
		}
		if err := a.decision.install(a.ctx, params.Engine); err != nil {
			return nil, err
		}
		return a.decision.status(), nil
	case "decision.evaluate":
		batch, err := decodeParams[decisionBatch](req.Params)
		if err != nil {
			return nil, err
		}
		return a.decision.evaluate(a.ctx, batch)
	case "decision.extract":
		params, err := decodeParams[extractParams](req.Params)
		if err != nil {
			return nil, err
		}
		return a.decision.extract(a.ctx, params.Text, params.Labels)
	case "session.create":
		p, err := decodeParams[createParams](req.Params)
		if err != nil {
			return nil, err
		}
		probe, _, err := a.makeClient(p.Config, p.Credential)
		if err != nil {
			return nil, err
		}
		_ = probe.Close()
		id := session.ID(uuid.New().String())
		if _, err := a.store.Create(a.ctx, id); err != nil {
			return nil, err
		}
		if err := a.saveConfig(id, p.Config); err != nil {
			return nil, err
		}
		if _, err := a.start(id, p.Credential); err != nil {
			return nil, err
		}
		return map[string]string{"sessionId": string(id)}, nil
	case "session.list":
		infos, err := a.store.ListSessions(a.ctx)
		if err != nil {
			return nil, err
		}
		result := make([]map[string]any, 0, len(infos))
		for _, info := range infos {
			a.mu.Lock()
			_, active := a.running[info.ID]
			state := "stopped"
			if run := a.running[info.ID]; run != nil {
				state = "idle"
				if run.busy.Load() {
					state = "running"
				}
				if run.stopping.Load() {
					state = "cancelling"
				}
			}
			a.mu.Unlock()
			config, _ := a.loadConfig(info.ID)
			result = append(result, map[string]any{"id": string(info.ID), "lastUpdatedAt": info.LastUpdatedAt, "title": a.title(info.ID), "active": active, "state": state, "parentSessionId": config.ParentSessionID})
		}
		sort.Slice(result, func(i, j int) bool {
			return result[i]["lastUpdatedAt"].(time.Time).After(result[j]["lastUpdatedAt"].(time.Time))
		})
		return result, nil
	case "session.open":
		p, err := decodeParams[openParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if _, err := a.start(id, p.Credential); err != nil {
			return nil, err
		}
		return map[string]bool{"active": true}, nil
	case "session.config":
		p, err := decodeParams[sessionIDParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		return a.loadConfig(id)
	case "session.send":
		p, err := decodeParams[sendParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		advice := a.preflight(id, p.Prompt)
		a.rememberPostflight(id, p.MessageID, p.Prompt)
		input, err := externalInputWithAdvice(p.Prompt, p.MessageID, advice)
		if err != nil {
			a.forgetPostflight(id, p.MessageID)
			return nil, err
		}
		if err := a.submit(id, input, p.Credential); err != nil {
			a.forgetPostflight(id, p.MessageID)
			return nil, err
		}
		return map[string]string{"messageId": string(input.ID)}, nil
	case "session.stop":
		p, err := decodeParams[sessionIDParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		if run == nil {
			return map[string]bool{"stopping": false}, nil
		}
		run.stopping.Store(true)
		payload, err := json.Marshal(inbox.ControlMessage{Mode: inbox.StopHard, Reason: "Stopped by user"})
		if err != nil {
			return nil, err
		}
		err = run.inbox.Submit(a.ctx, inbox.Input{ID: inbox.ID(uuid.New().String()), Kind: inbox.InputControl, Payload: payload})
		if err != nil {
			return nil, err
		}
		select {
		case <-run.done:
			return map[string]bool{"stopping": true}, nil
		case <-time.After(20 * time.Second):
			return nil, errors.New("session stop timed out")
		case <-a.ctx.Done():
			return nil, a.ctx.Err()
		}
	case "operation.cancel":
		p, err := decodeParams[cancelOperationParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(p.OperationID) == "" {
			return nil, errors.New("operation ID is required")
		}
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		if run == nil {
			return nil, errors.New("session is not active")
		}
		if err := run.manager.CancelUser(operation.ID(p.OperationID)); err != nil {
			return nil, err
		}
		return map[string]bool{"canceling": true}, nil
	case "session.fork":
		p, err := decodeParams[forkParams](req.Params)
		if err != nil {
			return nil, err
		}
		parent, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		turn, err := a.lastCompletedTurn(parent)
		if err != nil {
			return nil, err
		}
		config, err := a.loadConfig(parent)
		if err != nil {
			return nil, err
		}
		probe, _, err := a.makeClient(config, p.Credential)
		if err != nil {
			return nil, err
		}
		_ = probe.Close()
		id := session.ID(uuid.New().String())
		if _, err := a.store.Fork(a.ctx, id, parent, turn); err != nil {
			return nil, err
		}
		if err := a.saveConfig(id, config); err != nil {
			return nil, err
		}
		if _, err := a.start(id, p.Credential); err != nil {
			return nil, err
		}
		return map[string]string{"sessionId": string(id)}, nil
	case "session.events":
		p, err := decodeParams[historyParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.events.flush()
		if err := a.events.reconcile(a.store, id); err != nil {
			return nil, err
		}
		return a.events.entries(id, p.After, p.Limit)
	case "session.items":
		p, err := decodeParams[historyParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		return a.store.Items(a.ctx, id, sessionstore.Sequence(p.After), min(max(p.Limit, 1), 1000))
	default:
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}
}

func (a *app) title(id session.ID) string {
	page, err := a.store.Items(a.ctx, id, 0, 1000)
	if err != nil {
		return "New session"
	}
	fromFork := false
	for _, item := range page.Items {
		if item.Kind == sessionstore.ItemFork {
			fromFork = true
		}
	}
	for _, item := range page.Items {
		if item.Kind != sessionstore.ItemInput {
			continue
		}
		input, ok := item.Data.(inbox.Input)
		if !ok || input.Kind != inbox.InputExternal {
			continue
		}
		var prompt string
		if json.Unmarshal(input.Payload, &prompt) != nil {
			var value struct {
				Prompt string `json:"prompt"`
			}
			if json.Unmarshal(input.Payload, &value) != nil {
				continue
			}
			prompt = value.Prompt
		}
		prompt = strings.Join(strings.Fields(strings.SplitN(prompt, "<unrealcode_context>", 2)[0]), " ")
		if len(prompt) > 48 {
			prompt = prompt[:48] + "…"
		}
		if prompt != "" {
			if fromFork {
				return "Fork · " + prompt
			}
			return prompt
		}
	}
	return "New session"
}

func (a *app) lastCompletedTurn(id session.ID) (session.TurnID, error) {
	var after sessionstore.Sequence
	var latest session.TurnID
	for {
		page, err := a.store.Items(a.ctx, id, after, 256)
		if err != nil {
			return "", err
		}
		for _, item := range page.Items {
			if item.Kind == sessionstore.ItemModelResponse {
				latest = item.Data.(sessionstore.ModelResponse).TurnID
			}
		}
		if !page.More {
			break
		}
		after = page.NextAfter
	}
	if latest == "" {
		return "", errors.New("no completed turn to fork")
	}
	return latest, nil
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	state := os.Getenv("UNREAL_DESKTOP_STATE")
	if state == "" {
		state = "/state"
	}
	state, err := filepath.Abs(state)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	out := &output{w: os.Stdout}
	a, err := newApp(ctx, state, out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var requests sync.WaitGroup
	err = readRequests(os.Stdin, func(req request) {
		requests.Add(1)
		go func() {
			defer requests.Done()
			result, dispatchErr := a.dispatch(req)
			response := reply{Version: protocolVersion, ID: req.ID, OK: dispatchErr == nil, Result: result}
			if dispatchErr != nil {
				response.Error = dispatchErr.Error()
				response.Result = nil
			}
			if err := out.write(response); err != nil {
				fmt.Fprintln(os.Stderr, "write reply:", err)
			}
		}()
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "read requests:", err)
	}
	requests.Wait()
	cancel()
	a.runs.Wait()
	a.events.flush()
}
