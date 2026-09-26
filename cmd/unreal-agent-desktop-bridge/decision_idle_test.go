package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"uuid"

	"github.com/unreallabsai/unreal-agent/cmd/internal/agentrunner"
	"github.com/unreallabsai/unreal-agent/harness/session"
)

func TestPostflightRunsAfterIdleWithoutProviderPhase(t *testing.T) {
	workspace := t.TempDir()
	path := filepath.Join(workspace, "sample.txt")
	if err := os.WriteFile(path, []byte("before\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"init"}, {"add", "."}, {"-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "baseline"}} {
		command := exec.Command("git", args...)
		command.Dir = workspace
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git: %s %v", output, err)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content, err := os.ReadFile(path)
		if err != nil || string(content) != "after\n" {
			t.Error("decision ran before tool completed")
		}
		_, _ = w.Write([]byte(`{"model":"fixture","answers":{"requirement_alignment":{"type":"noul","noul":0.8},"contradiction_signal":{"type":"noul","noul":0.1}},"usage":{"input_tokens":20,"output_tokens":4}}`))
	}))
	defer server.Close()
	a, cancel, _, _ := testApp(t, t.TempDir(), false)
	defer cancel()
	a.workspace = workspace
	a.decision.endpoint = server.URL
	if err := a.decision.configure(decisionConfig{Engine: "jev", APIKey: "fixture"}); err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int32{}
	a.makeClient = func(_ sessionConfig, _ credential) (agentrunner.Client, string, error) {
		return &fakeClient{calls: calls, toolFirst: true, toolCommand: "printf 'after\\n' > " + strconv.Quote(path)}, "fake", nil
	}
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fake"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	before, ok := gitEvidence(a.ctx, workspace)
	if !ok {
		t.Fatal("missing git evidence")
	}
	a.postflight[id] = postflightCandidate{messageID: uuid.New().String(), prompt: "Change sample to after", before: before}
	if _, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "task"})}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		a.events.flush()
		entries, err := a.events.entries(id, 0, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.Event == "decision.result" {
				return true
			}
		}
		return false
	})
}
