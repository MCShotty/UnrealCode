package main

import (
	"context"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"testing"
)

func TestHookSuccessCannotApproveOriginalShell(t *testing.T) {
	a, stop, _, _ := testApp(t, t.TempDir(), true)
	defer stop()
	a.hooksEnabled.Store(true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inner := &permissionTestManager{updates: make(chan operation.Operation)}
	permission := newPermissionManager(ctx, inner, "ask", "workspace", "session", nil)
	manager := newHookManager(ctx, permission, a, "session", "workspace", "ask")
	if err := manager.Add(shellFixture(t, "shell")); err != nil {
		t.Fatal(err)
	}
	if err := manager.Add(readFixture(t)); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { a.host.mu.Lock(); defer a.host.mu.Unlock(); return len(a.host.pending) == 2 })
	a.host.mu.Lock()
	for _, call := range a.host.pending {
		call.reply <- hostReply{Text: "Hook passed"}
	}
	a.host.mu.Unlock()
	waitFor(t, func() bool { return inner.count() == 1 && len(permission.list()) == 1 })
	if permission.list()[0].Tool != "Bash" {
		t.Fatal("Original shell approval was bypassed")
	}
	if err := manager.Cancel("shell", "fixture cancellation"); err != nil {
		t.Fatal(err)
	}
	cancel()
	close(inner.updates)
}
func TestHookRejectionDoesNotDispatchAndPlanSkipsCommands(t *testing.T) {
	a, stop, _, _ := testApp(t, t.TempDir(), true)
	defer stop()
	a.hooksEnabled.Store(true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inner := &permissionTestManager{updates: make(chan operation.Operation)}
	if newHookManager(ctx, inner, a, "session", "workspace", "plan") != inner {
		t.Fatal("Plan must not execute command hooks")
	}
	manager := newHookManager(ctx, inner, a, "session", "workspace", "agent")
	_ = manager.Add(readFixture(t))
	waitFor(t, func() bool { a.host.mu.Lock(); defer a.host.mu.Unlock(); return len(a.host.pending) == 1 })
	a.host.mu.Lock()
	for _, call := range a.host.pending {
		call.reply <- hostReply{Error: true, Text: "Rejected"}
	}
	a.host.mu.Unlock()
	result := <-manager.Updates()
	if result.Status != operation.StatusFailed || inner.count() != 0 {
		t.Fatalf("hook rejection dispatched work: %+v", result)
	}
	cancel()
	close(inner.updates)
}
