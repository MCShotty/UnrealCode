package main

import (
	"context"
	"encoding/json/jsontext"
	"github.com/unreallabsai/unreal-agent/cmd/internal/agentrunner"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"uuid"
)

func TestPersistedApprovalRequiresFreshConsentAfterRestart(t *testing.T) {
	state := t.TempDir()
	target := filepath.Join(t.TempDir(), "approved.txt")
	first, stop, _, _ := testApp(t, state, true)
	first.workspace = t.TempDir()
	count := &atomic.Int32{}
	first.makeClient = func(sessionConfig, credential) (agentrunner.Client, string, error) {
		return &fakeClient{calls: count, toolFirst: true, toolCommand: "printf approved > " + strconv.Quote(target)}, "fake-model", nil
	}
	created, err := first.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Provider: "test", Model: "fake-model"}})})
	if err != nil {
		stop()
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	config, err := first.loadConfig(id)
	if err != nil || config.Mode != "ask" {
		stop()
		t.Fatal("new sessions must default to Ask")
	}
	if _, err = first.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "run fixture"})}); err != nil {
		stop()
		t.Fatal(err)
	}
	var old approvalRequest
	waitFor(t, func() bool {
		first.mu.Lock()
		run := first.running[id]
		first.mu.Unlock()
		if run == nil {
			return false
		}
		requests := run.permissions.list()
		if len(requests) == 0 {
			return false
		}
		old = requests[0]
		return true
	})
	stop()
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("unapproved command executed")
	}
	second, closeSecond, _, _ := testApp(t, state, false)
	second.workspace = first.workspace
	defer closeSecond()
	if _, err = second.dispatch(request{Version: 1, Method: "session.open", Params: mustJSON(t, openParams{SessionID: string(id)})}); err != nil {
		t.Fatal(err)
	}
	var fresh approvalRequest
	waitFor(t, func() bool {
		second.mu.Lock()
		run := second.running[id]
		second.mu.Unlock()
		if run == nil {
			return false
		}
		requests := run.permissions.list()
		if len(requests) == 0 {
			return false
		}
		fresh = requests[0]
		return true
	})
	if old.ID == fresh.ID {
		t.Fatal("approval nonce survived restart")
	}
	if _, err = second.dispatch(request{Version: 1, Method: "permission.respond", Params: mustJSON(t, map[string]any{"sessionId": id, "id": old.ID, "digest": old.Digest, "allow": true})}); err == nil {
		t.Fatal("stale approval accepted")
	}
	if _, err = second.dispatch(request{Version: 1, Method: "permission.respond", Params: mustJSON(t, map[string]any{"sessionId": id, "id": fresh.ID, "digest": fresh.Digest, "allow": true})}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { bytes, err := os.ReadFile(target); return err == nil && string(bytes) == "approved" })
}

type permissionTestManager struct {
	mu      sync.Mutex
	added   []operation.Operation
	updates chan operation.Operation
}

func (m *permissionTestManager) Add(value operation.Operation) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.added = append(m.added, value)
	return nil
}
func (m *permissionTestManager) Cancel(operation.ID, string) error   { return nil }
func (m *permissionTestManager) Updates() <-chan operation.Operation { return m.updates }
func (m *permissionTestManager) count() int                          { m.mu.Lock(); defer m.mu.Unlock(); return len(m.added) }
func shellFixture(t *testing.T, id string) operation.Operation {
	t.Helper()
	s, err := operation.NewShellSpec(operation.ShellInput{Command: "echo hello", Shell: "/bin/bash", Directory: "/workspace"}, t.TempDir(), 1024)
	if err != nil {
		t.Fatal(err)
	}
	return operation.Operation{ID: operation.ID(id), Type: s.Type, Version: s.Version, State: s.State, MaxOutputLength: s.MaxOutputLength, Status: operation.StatusReady}
}
func readFixture(t *testing.T) operation.Operation {
	t.Helper()
	s, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: filePlan, Version: 1, Data: jsontext.Value(`{"action":"read","path":"file.txt"}`)})
	if err != nil {
		t.Fatal(err)
	}
	return operation.Operation{ID: "read", Type: s.Type, Version: s.Version, State: s.State, MaxOutputLength: s.MaxOutputLength, Status: operation.StatusReady}
}
func TestApprovalsBindArgumentsAndDoNotBlockReads(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inner := &permissionTestManager{updates: make(chan operation.Operation)}
	m := newPermissionManager(ctx, inner, "ask", "workspace", "session", nil)
	if err := m.Add(shellFixture(t, "shell")); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 0 {
		t.Fatal("shell dispatched before approval")
	}
	if err := m.Add(readFixture(t)); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 1 {
		t.Fatal("unrelated read blocked by approval")
	}
	req := m.list()[0]
	if m.resolve(req.ID, "wrong-digest", true) == nil {
		t.Fatal("changed arguments approved")
	}
	if err := m.resolve(req.ID, req.Digest, true); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 2 {
		t.Fatal("approved command not dispatched")
	}
	if m.resolve(req.ID, req.Digest, true) == nil {
		t.Fatal("approval was reusable")
	}
}
func TestPlanDeniesShellAndAllowsRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inner := &permissionTestManager{updates: make(chan operation.Operation)}
	m := newPermissionManager(ctx, inner, "plan", "workspace", "session", nil)
	if err := m.Add(shellFixture(t, "shell")); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 0 {
		t.Fatal("Plan dispatched shell")
	}
	if err := m.Add(readFixture(t)); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 1 {
		t.Fatal("read failed")
	}
}
func TestApprovalCancelExpiryAndRestart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inner := &permissionTestManager{updates: make(chan operation.Operation)}
	m := newPermissionManager(ctx, inner, "ask", "workspace", "session", nil)
	value := shellFixture(t, "shell")
	_ = m.Add(value)
	old := m.list()[0]
	if err := m.Cancel(value.ID, "Stopped"); err != nil {
		t.Fatal(err)
	}
	if m.resolve(old.ID, old.Digest, true) == nil {
		t.Fatal("cancelled approval worked")
	}
	other := newPermissionManager(ctx, inner, "ask", "workspace", "session", nil)
	_ = other.Add(value)
	fresh := other.list()[0]
	if old.ID == fresh.ID || other.resolve(old.ID, old.Digest, true) == nil {
		t.Fatal("restart reused approval")
	}
	other.mu.Lock()
	other.pending[fresh.ID].request.ExpiresAt = time.Now().Add(-time.Second)
	other.mu.Unlock()
	if err := other.resolve(fresh.ID, fresh.Digest, true); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 0 {
		t.Fatal("expired operation dispatched")
	}
}
