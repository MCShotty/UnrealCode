package main

import (
	"context"
	"encoding/json/v2"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
	"os"
	"path/filepath"
	"testing"
	"uuid"
)

func TestAcceptedReceiptRestoresOnlyAfterExplicitResume(t *testing.T) {
	state := t.TempDir()
	a, cancel, _, _ := testApp(t, state, false)
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fixture", WorkspaceID: "workspace"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	input, err := externalInput("Accepted but not yet consumed", uuid.New().String())
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acceptInputReceipt(id, "workspace", 1, input); err != nil {
		t.Fatal(err)
	}
	cancel()
	reopened, closeApp, _, calls := testApp(t, state, false)
	defer closeApp()
	if calls.Load() != 0 || len(reopened.running) != 0 {
		t.Fatal("receipt started execution after restart")
	}
	pending, err := reopened.pendingInputReceipts(id, "workspace", map[inbox.ID]struct{}{})
	if err != nil || len(pending) != 1 || pending[0].ID != input.ID {
		t.Fatalf("pending receipts: %v %v", pending, err)
	}
	if _, err := reopened.dispatch(request{Version: 1, Method: "session.open", Params: mustJSON(t, openParams{SessionID: string(id)})}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return calls.Load() == 1 })
	if err := reopened.submit(id, input, credential{}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		items := allItems(t, reopened, id)
		for _, item := range items {
			if item.Kind == sessionstore.ItemModelResponse {
				return true
			}
		}
		return false
	})
	count := 0
	for _, item := range allItems(t, reopened, id) {
		if item.Kind == sessionstore.ItemInput && item.Data.(inbox.Input).ID == input.ID {
			count++
		}
	}
	if count != 1 {
		t.Fatal("accepted input was replayed twice")
	}
	if _, err := os.Stat(filepath.Join(reopened.receiptDirectory(id), string(input.ID)+".json")); !os.IsNotExist(err) {
		t.Fatal("consumed receipt was retained")
	}
}
func TestReceiptRejectsChangedContentWorkspaceAndCorruption(t *testing.T) {
	a, cancel, _, _ := testApp(t, t.TempDir(), false)
	defer cancel()
	id := session.ID(uuid.New().String())
	input, _ := externalInput("original", uuid.New().String())
	if err := a.acceptInputReceipt(id, "one", 1, input); err != nil {
		t.Fatal(err)
	}
	changed, _ := externalInput("changed", string(input.ID))
	if err := a.acceptInputReceipt(id, "one", 1, changed); err == nil {
		t.Fatal("same message identity accepted different content")
	}
	if _, err := a.pendingInputReceipts(id, "two", nil); err == nil {
		t.Fatal("cross-workspace receipt restored")
	}
	path := filepath.Join(a.receiptDirectory(id), string(input.ID)+".json")
	data, _ := os.ReadFile(path)
	var value inputReceipt
	_ = json.Unmarshal(data, &value)
	value.Hash = "corrupted"
	data, _ = json.Marshal(value)
	_ = os.WriteFile(path, data, 0600)
	if _, err := a.pendingInputReceipts(id, "one", nil); err == nil {
		t.Fatal("corrupt receipt restored")
	}
}
func TestAdvisoryBackupIsVerifiedAndLeavesLiveJournalIntact(t *testing.T) {
	a, cancel, _, _ := testApp(t, t.TempDir(), false)
	defer cancel()
	id := session.ID(uuid.New().String())
	if _, err := a.store.Create(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	input, _ := externalInput("accepted task", uuid.New().String())
	if err := a.store.AppendInput(a.ctx, id, input); err != nil {
		t.Fatal(err)
	}
	if err := a.ensureAdvisoryBackup(a.ctx, id); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(a.root, "before-async-advisory-v1", string(id), string(id)+".session.jsonl")
	before, _ := os.ReadFile(path)
	next, _ := externalInput("later steering", uuid.New().String())
	if err := a.store.AppendInput(a.ctx, id, next); err != nil {
		t.Fatal(err)
	}
	if err := a.ensureAdvisoryBackup(a.ctx, id); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("recovery backup was replaced by newer history")
	}
	if len(allItems(t, a, id)) != 2 {
		t.Fatal("backup changed the live journal")
	}
}
func TestAdvisoryBindingRejectsEveryChangedOwnershipField(t *testing.T) {
	a, cancel, _, _ := testApp(t, t.TempDir(), false)
	defer cancel()
	ctx, closeRun := context.WithCancel(a.ctx)
	defer closeRun()
	b := inbox.AdvisoryBinding{ProjectID: "project", WorkspaceID: "workspace", SessionID: "session", RunID: "run", SourceInputID: "source", RequestGeneration: 1, DecisionGeneration: 1, ContextRevision: 1}
	run := &runningSession{ctx: ctx, advisoryBinding: b}
	if !a.advisoryValid(run, b, false) {
		t.Fatal("current binding rejected")
	}
	changes := []func(*inbox.AdvisoryBinding){func(v *inbox.AdvisoryBinding) { v.ProjectID = "other" }, func(v *inbox.AdvisoryBinding) { v.WorkspaceID = "other" }, func(v *inbox.AdvisoryBinding) { v.SessionID = "other" }, func(v *inbox.AdvisoryBinding) { v.RunID = "other" }, func(v *inbox.AdvisoryBinding) { v.SourceInputID = "other" }, func(v *inbox.AdvisoryBinding) { v.RequestGeneration++ }, func(v *inbox.AdvisoryBinding) { v.DecisionGeneration++ }, func(v *inbox.AdvisoryBinding) { v.ContextRevision++ }}
	for i, change := range changes {
		different := b
		change(&different)
		if a.advisoryValid(run, different, false) {
			t.Fatalf("changed binding field %d accepted", i)
		}
	}
	run.advisorySettled = true
	if a.advisoryValid(run, b, false) {
		t.Fatal("completed work reopened")
	}
	run.advisorySettled = false
	run.stopping.Store(true)
	if a.advisoryValid(run, b, false) {
		t.Fatal("stopped work accepted late advice")
	}
}
