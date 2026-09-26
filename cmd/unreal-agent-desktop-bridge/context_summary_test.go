package main

import (
	"github.com/unreallabsai/unreal-agent/harness/coordinator"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
	"strings"
	"testing"
	"uuid"
)

func TestContextCompactionIsReversibleAcrossRestart(t *testing.T) {
	state := t.TempDir()
	a, closeApp, _, calls := testApp(t, state, false)
	config := sessionConfig{Provider: "test", Model: "fixture", Mode: "plan", SystemPrompt: "PINNED_INSTRUCTION"}
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: config})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	prompt := "Original task details and verification " + strings.Repeat("evidence ", 300)
	_, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: prompt})})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		a.mu.Lock()
		defer a.mu.Unlock()
		return calls.Load() > 0 && a.running[id] != nil && !a.running[id].busy.Load()
	})
	summary, err := a.createSummary(id, credential{})
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Active || summary.PrefixItems < 3 || summary.Usage["input"] != 10 {
		t.Fatalf("bad summary: %+v", summary)
	}
	items := allItems(t, a, id)
	responses := 0
	for _, item := range items {
		if item.Kind == sessionstore.ItemModelResponse {
			responses++
		}
	}
	if responses != 2 {
		t.Fatal("summary usage not persisted as a separate response")
	}
	closeApp()
	resumed, closeResumed, _, _ := testApp(t, state, false)
	defer closeResumed()
	builder, registry, err := resumed.contextBuilder(id, config, "fixture", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = coordinator.RebuildContext(t.Context(), id, resumed.store, builder, registry); err != nil {
		t.Fatal(err)
	}
	projected, err := builder.Build()
	if err != nil {
		t.Fatal(err)
	}
	if len(projected.Request.Input) != 2 || !strings.Contains(projected.Request.Input[0].Data.(llm.Message).Text, "PINNED_INSTRUCTION") {
		t.Fatal("summary lost current instructions")
	}
	if !strings.Contains(projected.Request.Input[1].Data.(llm.Message).Text, "unrealcode_history_summary") {
		t.Fatal("summary not applied on restart")
	}
	if err = resumed.activateSummary(id, ""); err != nil {
		t.Fatal(err)
	}
	restored, registry, err := resumed.contextBuilder(id, config, "fixture", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = coordinator.RebuildContext(t.Context(), id, resumed.store, restored, registry); err != nil {
		t.Fatal(err)
	}
	raw, err := restored.Build()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(mustJSON(t, raw.Request.Input)), "Original task details") {
		t.Fatal("original history not recoverable")
	}
	altered := append([]llm.Item(nil), raw.Request.Input...)
	altered[1] = llm.Item{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleUser, Text: "changed"}}
	if _, err = projectSummary(altered, summary); err == nil {
		t.Fatal("stale history fingerprint accepted")
	}
}
func TestCompactionRejectsPendingTools(t *testing.T) {
	a, closeApp, _, calls := testApp(t, t.TempDir(), true)
	defer closeApp()
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Provider: "test", Model: "fixture", Mode: "ask"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	_, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "pending approval"})})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return calls.Load() > 0 })
	if _, err = a.createSummary(id, credential{}); err == nil {
		t.Fatal("compacted active work")
	}
}
