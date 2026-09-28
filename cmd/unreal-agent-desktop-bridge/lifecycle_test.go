package main

import (
	"github.com/unreallabsai/unreal-agent/harness/session"
	"io"
	"os"
	"testing"
	"time"
)

func TestLifecycleRecoveryAndReplay(t *testing.T) {
	for _, retry := range []bool{false, true} {
		t.Run(map[bool]string{true: "recovered", false: "warning"}[retry], func(t *testing.T) {
			dir := t.TempDir()
			log, err := newEventLog(dir, &output{w: io.Discard})
			if err != nil {
				t.Fatal(err)
			}
			id := session.ID("session")
			appendEvent := func(kind string, p any) {
				t.Helper()
				if err := log.append(id, kind, p, 0); err != nil {
					t.Fatal(err)
				}
			}
			appendEvent("session.item", map[string]any{"Kind": "input", "Data": map[string]any{"Kind": "external", "ID": "message"}})
			call := func(callID, status string) {
				appendEvent("session.item", map[string]any{"Kind": "model_response", "Data": map[string]any{"TurnID": "turn", "Response": map[string]any{"Output": []any{map[string]any{"Type": "tool_call", "Data": map[string]any{"CallID": callID, "Name": "ReadFile", "Arguments": `{"path":"a"}`}}}}}})
				appendEvent("session.item", map[string]any{"Kind": "tool_call_status", "Data": map[string]any{"TurnID": "turn", "CallID": callID, "Status": map[string]any{"WaitingFor": []string{callID}}, "Operations": []any{map[string]any{"ID": callID, "Status": status}}}})
			}
			call("one", "failed")
			if retry {
				call("two", "completed")
			}
			appendEvent("session.idle", map[string]any{"messageIds": []string{"message"}})
			appendEvent("session.status", map[string]string{"status": "stopped"})
			want := "completed_with_warnings"
			if retry {
				want = "completed"
			}
			for _, removeSummary := range []bool{false, true} {
				if removeSummary {
					_ = os.Remove(log.path(id) + ".summary.json")
				}
				restored, _ := newEventLog(dir, &output{w: io.Discard})
				got, err := restored.outcome(id, false)
				if err != nil || got.State != want || len(got.MessageIDs) != 1 {
					t.Fatalf("replay: %+v %v", got, err)
				}
			}
		})
	}
}
func TestLifecycleInterruptedAndFatal(t *testing.T) {
	log, _ := newEventLog(t.TempDir(), &output{w: io.Discard})
	id := session.ID("session")
	_ = log.append(id, "session.item", map[string]any{"Kind": "input", "Data": map[string]any{"Kind": "external", "ID": "m"}}, 0)
	got, _ := log.outcome(id, false)
	if got.State != "interrupted" {
		t.Fatal(got)
	}
	_ = log.appendAt(id, "session.status", map[string]string{"status": "error"}, 0, time.Now())
	got, _ = log.outcome(id, false)
	if got.State != "failed" {
		t.Fatal(got)
	}
}
func TestLifecyclePermissionAfterIdleSnapshot(t *testing.T) {
	log, _ := newEventLog(t.TempDir(), &output{w: io.Discard})
	id := session.ID("approval")
	for _, entry := range []struct {
		kind  string
		value any
	}{
		{"session.status", map[string]string{"status": "running"}},
		{"session.item", map[string]any{"Kind": "input", "Data": map[string]any{"Kind": "external", "ID": "m"}}},
		{"permission.requested", map[string]any{"operationId": "a"}},
		{"permission.requested", map[string]any{"operationId": "b"}},
		{"permission.resolved", map[string]any{"operationId": "a"}},
	} {
		if err := log.append(id, entry.kind, entry.value, 0); err != nil {
			t.Fatal(err)
		}
	}
	got, err := log.outcome(id, true)
	if err != nil || got.State != "waiting_input" {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestLifecycleFailedShellExitAndExactRetry(t *testing.T) {
	life := freshLifecycle()
	at := time.Now()
	life.consume("session.item", map[string]any{"Kind": "input", "Data": map[string]any{"Kind": "external", "ID": "m"}}, at)
	for i, code := range []float64{1, 0} {
		call := []string{"bad", "retry"}[i]
		life.consume("session.item", map[string]any{"Kind": "model_response", "Data": map[string]any{"TurnID": "turn", "Response": map[string]any{"Output": []any{map[string]any{"Type": "tool_call", "Data": map[string]any{"CallID": call, "Name": "Bash", "Arguments": `{"command":"test -f recovered.txt"}`}}}}}}, at)
		life.consume("session.item", map[string]any{"Kind": "tool_call_status", "Data": map[string]any{"TurnID": "turn", "CallID": call, "Status": map[string]any{}, "Operations": []any{map[string]any{"Status": "completed", "State": map[string]any{"Result": map[string]any{"ExitCode": code}}}}}}, at)
		if i == 0 && len(life.Failures) != 1 {
			t.Fatal("failing process exit was hidden")
		}
	}
	life.consume("session.idle", map[string]any{"messageIds": []any{"m"}}, at)
	if life.Outcome.State != "completed" {
		t.Fatal(life.Outcome)
	}
}
