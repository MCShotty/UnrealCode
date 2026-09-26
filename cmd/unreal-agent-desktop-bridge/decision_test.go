package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

func TestCanceledLocalDecisionDoesNotStartWorker(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	worker := &pythonWorker{}
	var result any
	err := worker.call(ctx, filepath.Join(t.TempDir(), "missing-python"), "evaluate", map[string]any{}, &result)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled inference tried to start a process: %v", err)
	}
}

func TestDecisionBatchUsesConfiguredJevAndPreservesProbabilities(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/systemone" || r.Header.Get("Authorization") != "Bearer qa-secret" {
			t.Errorf("unexpected decision request: %s", r.URL.Path)
		}
		var body struct {
			Model     string         `json:"model"`
			Questions map[string]any `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "jev-latest" || len(body.Questions) != 2 {
			t.Errorf("unexpected batch: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"code","probabilities":{"code":0.8,"other":0.2},"confidence":0.6},"relevant":{"type":"noul","noul":0.72}},"usage":{"input_tokens":71,"output_tokens":9}}`))
	}))
	defer server.Close()
	runtime := newDecisionRuntime()
	runtime.endpoint = server.URL + "/v1/systemone"
	if err := runtime.configure(decisionConfig{Engine: "jev", APIKey: "qa-secret"}); err != nil {
		t.Fatal(err)
	}
	batch := decisionBatch{State: map[string]any{"request": "fix code"}, SourceRefs: []string{"user:1"}, Questions: map[string]decisionQuestion{
		"route":    {Type: "choice", Instructions: "Which route?", Criteria: map[string]any{"code": "code work", "other": "other work"}},
		"relevant": {Type: "noul", Instructions: "Is the file relevant?"},
	}}
	result, err := runtime.evaluate(context.Background(), batch)
	if err != nil {
		t.Fatal(err)
	}
	if result.Engine != "jev" || result.Model != "jev-1.13.0" || len(result.Answers) != 2 || len(result.SourceRefs) != 1 {
		t.Fatalf("result lost provenance: %#v", result)
	}
	var answer struct {
		Noul float64 `json:"noul"`
	}
	if err := json.Unmarshal(result.Answers["relevant"], &answer); err != nil || answer.Noul != .72 {
		t.Fatalf("probability lost: %#v %v", answer, err)
	}
}

func TestDecisionToolIsRegisteredWithoutChangingBuiltins(t *testing.T) {
	definitions := decisionTools()
	if len(definitions) != 2 || definitions[0].Definition.Tool.Name != decisionToolName {
		t.Fatalf("unexpected definitions: %#v", definitions)
	}
	registry := tool.NewRegistry(tool.StaticTranslators{Extra: definitions}, decisionToolName)
	if len(registry.StaticDefinitions()) != 1 {
		t.Fatal("extra tool selection ignored")
	}
	if _, ok := registry.Resolve(decisionToolName); !ok {
		t.Fatal("decision translator unavailable")
	}
	if _, ok := registry.Resolve(entityToolName); ok {
		t.Fatal("disabled entity tool was exposed")
	}
}

func TestDecisionUnavailableDoesNotSilentlyFallback(t *testing.T) {
	runtime := newDecisionRuntime()
	if err := runtime.configure(decisionConfig{Engine: "laya"}); err != nil {
		t.Fatal(err)
	}
	_, err := runtime.evaluate(context.Background(), decisionBatch{State: "x", Questions: map[string]decisionQuestion{"q": {Type: "noul", Instructions: "Is x present?"}}})
	if err == nil {
		t.Fatal("missing selected local engine silently fell back")
	}
}

func TestInFlightDecisionKeepsOriginalEngineAfterGlobalSwitch(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = w.Write([]byte(`{"model":"jev-test","answers":{"q":{"type":"noul","noul":0.8}}}`))
	}))
	defer server.Close()
	runtime := newDecisionRuntime()
	runtime.endpoint = server.URL
	if err := runtime.configure(decisionConfig{Engine: "jev", APIKey: "test"}); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		result decisionResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := runtime.evaluate(context.Background(), decisionBatch{State: "text", Questions: map[string]decisionQuestion{"q": {Type: "noul", Instructions: "Is this text?"}}})
		done <- outcome{result, err}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("decision request did not start")
	}
	if err := runtime.configure(decisionConfig{Engine: "off"}); err != nil {
		t.Fatal(err)
	}
	close(release)
	value := <-done
	if value.err != nil || value.result.Engine != "jev" || runtime.status()["engine"] != "off" {
		t.Fatalf("in-flight switch: %#v %v", value.result, value.err)
	}
}

func TestPreflightCredentialRedaction(t *testing.T) {
	input := "Review Bearer private-token-value and sk-long-secret-value in this request"
	redacted := credentialPattern.ReplaceAllString(input, "[credential redacted]")
	if strings.Contains(redacted, "private-token-value") || strings.Contains(redacted, "sk-long-secret-value") {
		t.Fatalf("credential remained in decision state: %s", redacted)
	}
}

func TestPreflightSkipsDeterministicCommandButKeepsCodeTasks(t *testing.T) {
	if shouldPreflight("Inspect the workspace with Bash, run pwd, and report the directory only.") {
		t.Fatal("trivial deterministic command triggered a decision call")
	}
	if !shouldPreflight("Fix the failing build and update its regression test.") {
		t.Fatal("nontrivial code task skipped decision preflight")
	}
}

func TestPostChangeCheckRecordsFocusedDecision(t *testing.T) {
	workspace := t.TempDir()
	if out, err := exec.Command("git", "init", "-b", "main", workspace).CombinedOutput(); err != nil {
		t.Fatalf("init git: %v: %s", err, out)
	}
	path := filepath.Join(workspace, "answer.txt")
	if err := os.WriteFile(path, []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", workspace, "add", "answer.txt").CombinedOutput(); err != nil {
		t.Fatalf("stage: %v: %s", err, out)
	}
	before, ok := gitEvidence(context.Background(), workspace)
	if !ok {
		t.Fatal("missing git baseline")
	}
	if err := os.WriteFile(path, []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			State     map[string]string `json:"state"`
			Questions map[string]any    `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if !strings.Contains(body.State["change_delta"], "+after") || len(body.Questions) != 2 {
			t.Errorf("postflight lacked focused diff: %#v", body)
		}
		_, _ = w.Write([]byte(`{"model":"jev-test","answers":{"requirement_alignment":{"type":"noul","noul":0.9},"contradiction_signal":{"type":"noul","noul":0.1}},"usage":{"input_tokens":25}}`))
	}))
	defer server.Close()
	runtime := newDecisionRuntime()
	runtime.endpoint = server.URL
	if err := runtime.configure(decisionConfig{Engine: "jev", APIKey: "test"}); err != nil {
		t.Fatal(err)
	}
	log, err := newEventLog(t.TempDir(), &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	app := &app{ctx: context.Background(), workspace: workspace, decision: runtime, events: log}
	id := session.ID("postflight-test")
	app.verifyPostflight(id, postflightCandidate{prompt: "Fix the answer file to say after.", before: before})
	entries, err := log.readLocked(id)
	if err != nil || len(entries) != 1 || entries[0].Event != "decision.result" {
		t.Fatalf("postflight event: %#v %v", entries, err)
	}
	encoded, err := json.Marshal(entries[0].Payload)
	if err != nil {
		t.Fatal(err)
	}
	var trace map[string]any
	if err := json.Unmarshal(encoded, &trace); err != nil {
		t.Fatal(err)
	}
	if trace["purpose"] != "Post-change semantic verification" || trace["evidence"] == nil || trace["questions"] == nil || trace["answers"] == nil {
		t.Fatalf("missing decision trace fields: %s", encoded)
	}
}
