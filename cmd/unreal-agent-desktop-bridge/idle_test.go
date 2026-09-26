package main

import (
	"strings"
	"testing"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
)

func TestIdleEventWaitsForToolsAndIncludesSteering(t *testing.T) {
	a, cancel, _, _ := testApp(t, t.TempDir(), true)
	defer cancel()
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Provider: "test", Model: "fake-model"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	first, second := uuid.New().String(), uuid.New().String()
	send := func(message string) {
		t.Helper()
		if _, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: message, Prompt: "task"})}); err != nil {
			t.Fatal(err)
		}
	}
	send(first)
	waitFor(t, func() bool {
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		run.manager.mu.Lock()
		defer run.manager.mu.Unlock()
		return len(run.manager.known) > 0
	})
	send(second)
	waitFor(t, func() bool {
		a.events.flush()
		entries, err := a.events.entries(id, 0, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.Event != "session.idle" {
				continue
			}
			a.mu.Lock()
			run := a.running[id]
			a.mu.Unlock()
			run.manager.mu.Lock()
			defer run.manager.mu.Unlock()
			for _, status := range run.manager.known {
				if status != operation.StatusCompleted && status != operation.StatusFailed && status != operation.StatusCanceled {
					t.Fatal("idle was emitted while a tool was active")
				}
			}
			encoded := string(mustJSON(t, entry.Payload))
			if !strings.Contains(encoded, first) || !strings.Contains(encoded, second) {
				t.Fatalf("idle omitted steering message IDs: %s", encoded)
			}
			return true
		}
		return false
	})
}
