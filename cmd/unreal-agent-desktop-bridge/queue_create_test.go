package main

import (
	"sync"
	"testing"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/session"
)

func TestQueuedSessionCreateReusesItsIdentityAcrossRepliesAndRestart(t *testing.T) {
	state := t.TempDir()
	key := uuid.New().String()
	config := sessionConfig{Provider: "test", Model: "fake-model", Mode: "agent"}
	a, closeFirst, _, _ := testApp(t, state, false)
	create := func(current *app) string {
		t.Helper()
		result, err := current.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: config, QueueTaskID: key})})
		if err != nil {
			t.Fatal(err)
		}
		return result.(map[string]string)["sessionId"]
	}
	first := create(a)
	if first != key || create(a) != first {
		t.Fatalf("queued create changed identity: %s", first)
	}
	var concurrent sync.WaitGroup
	for range 8 {
		concurrent.Add(1)
		go func() {
			defer concurrent.Done()
			if create(a) != first {
				t.Error("concurrent queued create changed identity")
			}
		}()
	}
	concurrent.Wait()
	message := uuid.New().String()
	if _, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: first, MessageID: message, Prompt: "Retain this queued task input"})}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(allItems(t, a, session.ID(first))) > 0 })
	before := allItems(t, a, session.ID(first))
	if len(before) == 0 {
		t.Fatal("queued input was not persisted")
	}
	if create(a) != first || len(allItems(t, a, session.ID(first))) < len(before) {
		t.Fatal("duplicate create replaced queued session history")
	}
	other := config
	other.Model = "different-model"
	if _, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: other, QueueTaskID: key})}); err == nil {
		t.Fatal("queued key accepted a different model")
	}
	closeFirst()
	restarted, closeRestarted, _, _ := testApp(t, state, false)
	defer closeRestarted()
	if create(restarted) != first {
		t.Fatal("queued create did not recover its saved session")
	}
	infos, err := restarted.store.ListSessions(restarted.ctx)
	if err != nil || len(infos) != 1 {
		t.Fatalf("queued create made duplicate sessions: %d, %v", len(infos), err)
	}
}
