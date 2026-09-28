package main

import (
	"context"
	"encoding/json/v2"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"strings"
	"sync/atomic"
	"testing"
	"uuid"
)

func TestSpecialistShellNeedsApprovalWithoutBlockingReads(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inner := &permissionTestManager{updates: make(chan operation.Operation)}
	manager := newPermissionManager(ctx, inner, "agent", "worker-workspace", "worker-session", nil)
	manager.worker = true
	if err := manager.Add(shellFixture(t, "shell")); err != nil {
		t.Fatal(err)
	}
	if err := manager.Add(readFixture(t)); err != nil {
		t.Fatal(err)
	}
	if inner.count() != 1 || len(manager.list()) != 1 || manager.list()[0].Tool != "Bash" {
		t.Fatal("worker shell escaped approval or blocked the independent read")
	}
}
func TestTaskBudgetDenialPrecedesProviderRequest(t *testing.T) {
	a, close, _, _ := testApp(t, t.TempDir(), false)
	defer close()
	id := session.ID(uuid.New().String())
	count := &atomic.Int32{}
	client := &observedClient{inner: &fakeClient{calls: count}, events: a.events, id: id, app: a, config: sessionConfig{TeamManaged: true, WorkspaceID: "worker"}}
	done := make(chan error, 1)
	go func() {
		_, err := client.Respond(context.Background(), llm.Request{}, llm.RequestOptions{})
		done <- err
	}()
	var requestID string
	var pending hostPending
	waitFor(t, func() bool {
		a.host.mu.Lock()
		defer a.host.mu.Unlock()
		for key, value := range a.host.pending {
			requestID = key
			pending = value
			return true
		}
		return false
	})
	if err := a.host.resolve(hostReply{RequestID: requestID, SessionID: string(id), OperationID: string(pending.operation), Error: true, Text: "Reported token limit reached"}); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil || !strings.Contains(err.Error(), "token limit") {
		t.Fatalf("budget denial lost: %v", err)
	}
	if count.Load() != 0 {
		t.Fatal("provider called despite denied permit")
	}
	client.config.TeamManaged = false
	if _, err := client.Respond(context.Background(), llm.Request{}, llm.RequestOptions{}); err != nil || count.Load() != 1 {
		t.Fatal("ordinary sessions should not require a task permit")
	}
	a.events.flush()
	entries, err := a.events.entries(id, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	var started string
	recorded := false
	for _, entry := range entries {
		var value struct {
			ID    string    `json:"id"`
			Usage llm.Usage `json:"usage"`
		}
		if err = json.Unmarshal(entry.Payload, &value); err != nil {
			t.Fatal(err)
		}
		if entry.Event == "model.request.started" {
			started = value.ID
		}
		if entry.Event == "model.request.completed" {
			recorded = true
			if started == "" || value.ID != started || value.Usage.InputTokens != 10 || value.Usage.OutputTokens != 2 {
				t.Fatalf("request-correlated usage was not persisted: %+v", value)
			}
		}
	}
	if !recorded {
		t.Fatal("missing usage-bearing model completion")
	}
}
func TestTeamToolExposureRequiresOptInAndNeverNests(t *testing.T) {
	a, close, _, _ := testApp(t, t.TempDir(), false)
	defer close()
	a.workspace = t.TempDir()
	for _, config := range []sessionConfig{{Mode: "agent"}, {Mode: "agent", TeamEnabled: true}, {Mode: "agent", TeamEnabled: true, Specialist: true}} {
		builder, _, err := a.contextBuilder(session.ID(uuid.New().String()), config, "fixture", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		result, err := builder.Build()
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, tool := range result.Request.Tools {
			if tool.Name == "TeamDispatch" {
				found = true
			}
		}
		if found != (config.TeamEnabled && !config.Specialist) {
			t.Fatal("incorrect team schema exposure")
		}
	}
}
