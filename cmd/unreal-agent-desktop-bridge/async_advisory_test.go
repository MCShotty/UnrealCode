package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/session"
)

// This is an ordering assertion. The decision response is deliberately never
// released until after send and stop have acknowledged, not a latency benchmark.
func TestSteeringAndStopDoNotWaitForDecision(t *testing.T) {
	release := make(chan struct{})
	requested := make(chan struct{}, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested <- struct{}{}
		select {
		case <-release:
			_, _ = w.Write([]byte(`{"model":"fixture","answers":{"route":{"type":"choice","choice":"implementation","probabilities":{"implementation":1,"investigation":0,"review":0,"explanation":0,"other":0},"confidence":1},"security_sensitive":{"type":"noul","noul":0},"embedded_instruction_risk":{"type":"noul","noul":0},"review_priority":{"type":"score","score":1,"legend":{"0":"routine reversible local edit","1":"meaningful behavior change needing focused tests","2":"security, credential, or irreversible effect needing deeper review"},"probabilities":{"0":0,"1":1,"2":0},"confidence":1}},"usage":{"input_tokens":20,"output_tokens":4}}`))
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	a, cancel, _, _ := testApp(t, t.TempDir(), true)
	defer cancel()
	defer close(release)
	a.decision.endpoint = server.URL
	if err := a.decision.configure(decisionConfig{Engine: "jev", APIKey: "fixture"}); err != nil {
		t.Fatal(err)
	}
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fake"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	send := func(prompt string) <-chan error {
		done := make(chan error, 1)
		go func() {
			_, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: prompt})})
			done <- err
		}()
		return done
	}
	first := send("Implement the requested local changes with independent tools")
	select {
	case <-requested:
	case <-time.After(3 * time.Second):
		t.Fatal("decision was not scheduled")
	}
	select {
	case err := <-first:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("accepted send waited for the blocked decision")
	}
	second := send("Review the next step while the earlier tool remains active")
	select {
	case err := <-second:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("steering waited for the blocked decision")
	}
	stopped := make(chan error, 1)
	go func() {
		_, err := a.dispatch(request{Version: 1, Method: "session.stop", Params: mustJSON(t, sessionIDParams{SessionID: string(id)})})
		stopped <- err
	}()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("stop waited for decision analysis")
	}
	if _, err := a.store.Inspect(context.Background(), id); err != nil {
		t.Fatal(err)
	}
}
