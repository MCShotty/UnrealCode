package coordinator

import (
	"encoding/json/v2"
	"reflect"
	"strings"
	"testing"
	"testing/synctest"

	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/operation"
)

func adviceInput(t *testing.T, id inbox.ID, source inbox.ID, category string) inbox.Input {
	t.Helper()
	payload, err := json.Marshal(inbox.Advisory{Version: 1, Category: category, Binding: inbox.AdvisoryBinding{ProjectID: "project", WorkspaceID: "workspace", SessionID: "session-1", RunID: "run-1", SourceInputID: source, RequestGeneration: 1, DecisionGeneration: 1, ContextRevision: 1}, Text: "Fixture reference data"})
	if err != nil {
		t.Fatal(err)
	}
	return inbox.Input{ID: id, Kind: inbox.InputAdvisory, Payload: payload}
}
func TestAdvisoryWaitsForExistingBoundaryAndDoesNotInterrupt(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		run := newStopTestRun(t, 1)
		run.current.dependencies.AdvisoryValid = func(inbox.AdvisoryBinding) bool { return true }
		outcomes := map[inbox.ID]string{}
		run.current.dependencies.OnAdvisoryOutcome = func(id inbox.ID, state string) { outcomes[id] = state }
		run.start(t)
		run.input(t, externalEvent(t, 0, "request", "Inspect the workspace"))
		original := run.calls[0].request
		run.input(t, adviceInput(t, "advice", "request", "decision"))
		if run.requestCount() != 1 || run.calls[0].ctx.Err() != nil || !reflect.DeepEqual(original, run.calls[0].request) {
			t.Fatal("advice interrupted or mutated the submitted model request")
		}
		run.respond(t, 0, textResponse("Still waiting for the independent tool."))
		if run.requestCount() != 1 {
			t.Fatal("advice requested its own model turn")
		}
		run.update(t, 0, operation.StatusCompleted)
		if run.requestCount() != 2 || outcomes["advice"] != "delivered" {
			t.Fatalf("advice not delivered at tool boundary: %v", outcomes)
		}
		encoded, _ := json.Marshal(run.calls[1].request)
		if strings.Count(string(encoded), "Fixture reference data") != 1 {
			t.Fatal("advice not delivered exactly once")
		}
		run.respond(t, 1, textResponse("Done."))
		if run.requestCount() != 2 {
			t.Fatal("advice kept work open")
		}
		run.input(t, adviceInput(t, "late", "request", "decision"))
		if run.requestCount() != 2 || outcomes["late"] != "skipped" {
			t.Fatal("late advice resurrected completed work")
		}
	})
}
func TestAdvisoryCannotBypassHumanGate(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		run := newStopTestRun(t, 0)
		blocked := true
		run.current.dependencies.ModelBlocked = func() bool { return blocked }
		run.current.dependencies.AdvisoryValid = func(inbox.AdvisoryBinding) bool { return true }
		run.start(t)
		run.input(t, externalEvent(t, 0, "request", "Inspect"))
		run.input(t, adviceInput(t, "advice", "request", "decision"))
		if run.requestCount() != 0 {
			t.Fatal("advice bypassed a required answer or approval")
		}
		blocked = false
		run.input(t, heartbeatInput(t, "real-wakeup"))
		if run.requestCount() != 1 {
			t.Fatal("explicit wakeup did not request model")
		}
		encoded, _ := json.Marshal(run.calls[0].request)
		if !strings.Contains(string(encoded), "Fixture reference data") {
			t.Fatal("queued advice missing after human gate opened")
		}
	})
}
func TestAdvisoryRejectsStaleBindingsAndKeepsCategoriesSeparate(t *testing.T) {
	for _, scenario := range []string{"valid", "superseded", "host-revoked", "no-validator", "other-session"} {
		t.Run(scenario, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				run := newStopTestRun(t, 1)
				if scenario != "no-validator" {
					run.current.dependencies.AdvisoryValid = func(inbox.AdvisoryBinding) bool { return scenario != "host-revoked" }
				}
				run.start(t)
				run.input(t, externalEvent(t, 0, "request", "Inspect"))
				advice := adviceInput(t, "advice", "request", "decision")
				if scenario == "other-session" {
					value, _ := advice.DecodeAdvisory()
					value.Binding.SessionID = "other"
					advice.Payload, _ = json.Marshal(value)
				}
				run.input(t, advice, adviceInput(t, "memory", "request", "memory"), advice)
				if scenario == "superseded" {
					run.input(t, externalEvent(t, 0, "steer", "Change direction"))
					run.respond(t, 1, textResponse("Working."))
				} else {
					run.respond(t, 0, textResponse("Working."))
				}
				run.update(t, 0, operation.StatusCompleted)
				last := run.calls[len(run.calls)-1].request
				encoded, _ := json.Marshal(last)
				count := strings.Count(string(encoded), "Fixture reference data")
				want := 0
				if scenario == "valid" {
					want = 2
				}
				if scenario == "other-session" {
					want = 1
				}
				if count != want {
					t.Fatalf("references=%d want=%d in %s", count, want, encoded)
				}
			})
		})
	}
}
