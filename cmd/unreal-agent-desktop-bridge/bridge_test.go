package main

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/cmd/internal/agentrunner"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

type fakeClient struct {
	calls       *atomic.Int32
	toolFirst   bool
	toolCommand string
}

func (client *fakeClient) Close() error { return nil }
func (client *fakeClient) Respond(ctx context.Context, _ llm.Request, _ llm.RequestOptions) (llm.Response, error) {
	if err := ctx.Err(); err != nil {
		return llm.Response{}, err
	}
	call := client.calls.Add(1)
	if client.toolFirst && call == 1 {
		command := client.toolCommand
		if command == "" {
			command = "sleep 0.4; echo done"
		}
		return llm.Response{ID: uuid.New().String(), Stop: llm.StopComplete, Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "shell-1", Name: "Bash", Arguments: `{"command":` + strconv.Quote(command) + `}`}}}}, nil
	}
	return llm.Response{ID: uuid.New().String(), Stop: llm.StopComplete, Output: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleAssistant, Text: "Task complete"}}}, Usage: llm.Usage{InputTokens: 10, OutputTokens: 2}}, nil
}

func testApp(t *testing.T, state string, toolFirst bool) (*app, context.CancelFunc, *bytes.Buffer, *atomic.Int32) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	buffer := &bytes.Buffer{}
	a, err := newApp(ctx, state, &output{w: buffer})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	calls := &atomic.Int32{}
	a.makeClient = func(_ sessionConfig, _ credential) (agentrunner.Client, string, error) {
		return &fakeClient{calls: calls, toolFirst: toolFirst}, "fake-model", nil
	}
	return a, cancel, buffer, calls
}

func waitFor(t *testing.T, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if predicate() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timed out waiting for session event")
}

func allItems(t *testing.T, a *app, id session.ID) []sessionstore.Item {
	t.Helper()
	page, err := a.store.Items(context.Background(), id, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	return page.Items
}

func TestSessionSteeringForkAndReplay(t *testing.T) {
	state := t.TempDir()
	a, cancel, _, calls := testApp(t, state, true)
	defer cancel()
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Provider: "test", Model: "fake-model"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	first := uuid.New().String()
	_, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: first, Prompt: "first task"})})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		for _, item := range allItems(t, a, id) {
			if item.Kind == sessionstore.ItemToolCallStatus {
				return true
			}
		}
		return false
	})
	second := uuid.New().String()
	_, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: second, Prompt: "steer this while the tool runs"})})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		count := 0
		for _, item := range allItems(t, a, id) {
			if item.Kind == sessionstore.ItemInput {
				count++
			}
		}
		return count >= 2 && calls.Load() >= 2
	})
	_, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: second, Prompt: "steer this while the tool runs"})})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	count := 0
	for _, item := range allItems(t, a, id) {
		if item.Kind == sessionstore.ItemInput {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("duplicate input was persisted: %d", count)
	}
	waitFor(t, func() bool {
		for _, item := range allItems(t, a, id) {
			if item.Kind == sessionstore.ItemModelResponse {
				return true
			}
		}
		return false
	})
	forked, err := a.dispatch(request{Version: 1, Method: "session.fork", Params: mustJSON(t, forkParams{SessionID: string(id)})})
	if err != nil {
		t.Fatal(err)
	}
	forkID := session.ID(forked.(map[string]string)["sessionId"])
	if _, err := a.store.Inspect(context.Background(), forkID); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(a.title(forkID), "Fork · ") {
		t.Fatalf("fork title is not marked: %q", a.title(forkID))
	}
	if _, err := a.dispatch(request{Version: 1, Method: "session.events", Params: mustJSON(t, historyParams{SessionID: string(id), Limit: 1000})}); err != nil {
		t.Fatal(err)
	}
	cancel()
	newApp, newCancel, _, _ := testApp(t, state, false)
	defer newCancel()
	replayed, err := newApp.dispatch(request{Version: 1, Method: "session.events", Params: mustJSON(t, historyParams{SessionID: string(id), Limit: 1000})})
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed.([]event)) < 3 {
		t.Fatalf("expected durable activity after restart, got %d", len(replayed.([]event)))
	}
}

func TestConcurrentSessionsAndStop(t *testing.T) {
	a, cancel, _, _ := testApp(t, t.TempDir(), false)
	defer cancel()
	ids := make([]session.ID, 2)
	for i := range ids {
		created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Provider: "test", Model: "fake-model"}})})
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = session.ID(created.(map[string]string)["sessionId"])
	}
	for _, id := range ids {
		if _, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "hello"})}); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range ids {
		waitFor(t, func() bool {
			for _, item := range allItems(t, a, id) {
				if item.Kind == sessionstore.ItemModelResponse {
					return true
				}
			}
			return false
		})
		if _, err := a.dispatch(request{Version: 1, Method: "session.stop", Params: mustJSON(t, sessionIDParams{SessionID: string(id)})}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEventProjectionDeduplicatesAndPersists(t *testing.T) {
	state := t.TempDir()
	out := &output{w: &bytes.Buffer{}}
	log, err := newEventLog(filepath.Join(state, "events"), out)
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(uuid.New().String())
	if err := log.append(id, "session.item", map[string]any{"hello": "world"}, 1); err != nil {
		t.Fatal(err)
	}
	if err := log.append(id, "session.item", map[string]any{"hello": "world"}, 1); err != nil {
		t.Fatal(err)
	}
	if err := log.append(id, "operation.update", map[string]any{"status": "completed"}, 0); err != nil {
		t.Fatal(err)
	}
	restarted, err := newEventLog(filepath.Join(state, "events"), out)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := restarted.entries(id, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Sequence != 1 || entries[1].Sequence != 2 {
		t.Fatalf("bad replay: %+v", entries)
	}
	if err := restarted.append(id, "session.item", map[string]any{"hello": "world"}, 1); err != nil {
		t.Fatal(err)
	}
	entries, _ = restarted.entries(id, 0, 100)
	if len(entries) != 2 {
		t.Fatal("duplicate after restart")
	}
}

func TestProviderCredentialRoutingWithoutNetwork(t *testing.T) {
	apiClient, apiModel, err := clientFor(sessionConfig{Provider: "openai", Model: "gpt-6-astra"}, credential{APIKey: "unit-test-token"})
	if err != nil {
		t.Fatal(err)
	}
	if apiModel != "gpt-6-astra" {
		t.Fatalf("unexpected model %q", apiModel)
	}
	_ = apiClient.Close()
	codexClient, codexModel, err := clientFor(sessionConfig{Provider: "openai-codex", Model: "gpt-6-astra"}, credential{AccessToken: "unit-test-subscription-token", AccountID: "unit-test-account"})
	if err != nil {
		t.Fatal(err)
	}
	if codexModel != "gpt-6-astra" {
		t.Fatalf("unexpected Codex model %q", codexModel)
	}
	_ = codexClient.Close()
}

func TestProjectedResponseOmitsProviderPrivateRawFields(t *testing.T) {
	raw := jsontext.Value(`{"private":"provider-state"}`)
	original := sessionstore.Item{Kind: sessionstore.ItemModelResponse, Data: sessionstore.ModelResponse{Response: llm.Response{
		Usage:  llm.Usage{InputTokens: 3, Raw: raw},
		Output: []llm.Item{{Type: llm.ItemReasoning, Data: llm.Reasoning{Summary: []string{"summary"}, Raw: raw}}},
	}}}
	projected := projectItem(original).Data.(sessionstore.ModelResponse)
	if projected.Response.Usage.Raw != nil || projected.Response.Output[0].Data.(llm.Reasoning).Raw != nil {
		t.Fatal("provider raw fields reached UI projection")
	}
	canonical := original.Data.(sessionstore.ModelResponse)
	if canonical.Response.Usage.Raw == nil || canonical.Response.Output[0].Data.(llm.Reasoning).Raw == nil {
		t.Fatal("canonical response was changed")
	}
}

func TestLiveShellOperationCanBeCanceledWithoutStoppingSession(t *testing.T) {
	a, cancel, _, calls := testApp(t, t.TempDir(), false)
	defer cancel()
	a.makeClient = func(_ sessionConfig, _ credential) (agentrunner.Client, string, error) {
		return &fakeClient{calls: calls, toolFirst: true, toolCommand: "sleep 5; echo should-not-finish"}, "fake-model", nil
	}
	created, err := a.dispatch(request{Version: protocolVersion, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Provider: "test", Model: "fake-model"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	_, err = a.dispatch(request{Version: protocolVersion, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "Run a long shell command"})})
	if err != nil {
		t.Fatal(err)
	}
	var operationID operation.ID
	waitFor(t, func() bool {
		a.events.flush()
		entries, err := a.events.entries(id, 0, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.Event != "operation.started" {
				continue
			}
			var value operation.Operation
			if err := json.Unmarshal(entry.Payload, &value); err != nil {
				t.Fatal(err)
			}
			operationID = value.ID
			return operationID != "" && !entry.RecordedAt.IsZero()
		}
		return false
	})
	_, err = a.dispatch(request{Version: protocolVersion, Method: "operation.cancel", Params: mustJSON(t, cancelOperationParams{SessionID: string(id), OperationID: string(operationID)})})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		a.events.flush()
		entries, err := a.events.entries(id, 0, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.Event != "operation.update" {
				continue
			}
			var value operation.Operation
			if err := json.Unmarshal(entry.Payload, &value); err != nil {
				t.Fatal(err)
			}
			if value.ID == operationID && value.Status == operation.StatusCanceled {
				return true
			}
		}
		return false
	})
	a.mu.Lock()
	_, running := a.running[id]
	a.mu.Unlock()
	if !running {
		t.Fatal("individual cancellation stopped the session")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
