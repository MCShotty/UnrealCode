package main

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"github.com/unreallabsai/unreal-agent/cmd/internal/agentrunner"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"uuid"
)

func TestQuestionReceiptsOwnershipAndReplay(t *testing.T) {
	root := t.TempDir()
	a, stop, _, _ := testApp(t, root, false)
	defer stop()
	id := session.ID(uuid.New().String())
	args := workflowArgs{Mode: "background", Questions: []questionItem{{ID: "target", Title: "Choose target", Choices: []questionChoice{{ID: "a", Label: "Alpha"}, {ID: "b", Label: "Beta"}}}, {ID: "note", Title: "Any notes?"}}}
	if err := normalizeQuestions(&args); err != nil {
		t.Fatal(err)
	}
	q, err := a.questions.create(id, "workspace", "request", args)
	if err != nil {
		t.Fatal(err)
	}
	if a.questions.blocked(id) {
		t.Fatal("Background question blocked model")
	}
	q, err = a.questions.promote(id, q.ID)
	if err != nil || !a.questions.blocked(id) {
		t.Fatal("WaitForInput did not block", err)
	}
	p := answerQuestionParams{ID: q.ID, WorkspaceID: "workspace", Revision: 1, SubmissionID: uuid.New().String(), Answers: []questionAnswer{{QuestionID: "target", ChoiceID: "a"}, {QuestionID: "note", Text: "Keep it small"}}}
	bad := p
	bad.WorkspaceID = "different"
	if _, err = a.questions.answer(id, bad); err == nil {
		t.Fatal("Cross-workspace answer accepted")
	}
	bad = p
	bad.Revision = 2
	if _, err = a.questions.answer(id, bad); err == nil {
		t.Fatal("Stale answer accepted")
	}
	var group sync.WaitGroup
	for range 10 {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := a.questions.answer(id, p); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	rows, _ := a.questions.list(id, "")
	if len(rows) != 1 || rows[0].State != "answered" || len(rows[0].Answers) != 2 {
		t.Fatal(rows)
	}
	bad = p
	bad.SubmissionID = uuid.New().String()
	if _, err = a.questions.answer(id, bad); err == nil {
		t.Fatal("New submission answered twice")
	}
	reopened := &questionLedger{root: a.questions.root, events: a.events}
	rows, err = reopened.list(id, "")
	if err != nil || rows[0].SubmissionID != p.SubmissionID {
		t.Fatal("Lost receipt", err)
	}
	if err = os.Remove(filepath.Join(a.questions.root, string(id)+".json")); err != nil {
		t.Fatal(err)
	}
	reconstructed := &questionLedger{root: a.questions.root, events: a.events}
	rows, err = reconstructed.list(id, "")
	if err != nil || rows[0].SubmissionID != p.SubmissionID {
		t.Fatal("Canonical replay lost receipt", err)
	}
}

func TestAnswerBeforeRequiredOperationRegistrationCompletes(t *testing.T) {
	a, stop, _, _ := testApp(t, t.TempDir(), false)
	defer stop()
	id := session.ID(uuid.New().String())
	args := workflowArgs{Action: "input", Mode: "required", Questions: []questionItem{{ID: "choice", Title: "Target?", Choices: []questionChoice{{ID: "a", Label: "Alpha"}}}}}
	if err := normalizeQuestions(&args); err != nil {
		t.Fatal(err)
	}
	q, err := a.questions.create(id, "workspace", "early-answer", args)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.questions.answer(id, answerQuestionParams{ID: q.ID, WorkspaceID: "workspace", Revision: q.Revision, SubmissionID: uuid.New().String(), Answers: []questionAnswer{{QuestionID: "choice", ChoiceID: "a"}}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := newWorkflowHandler(ctx, &contextPreferences{}, t.TempDir(), a.events, id)
	h.questions = a.questions
	h.workspaceID = "workspace"
	data, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: workflowPlan, Version: 1, Data: jsontext.Value(data)})
	if err != nil {
		t.Fatal(err)
	}
	op := operation.Operation{ID: operation.ID(q.ID), Type: spec.Type, Version: spec.Version, State: spec.State, MaxOutputLength: spec.MaxOutputLength, Status: operation.StatusAwaiting}
	h.waiting[op.ID] = op
	h.waitingQuestions = map[operation.ID]string{op.ID: q.ID}
	if pending, err := h.reconcileQuestion(q.ID); err != nil || pending {
		t.Fatalf("answered question stayed pending: %v, %v", pending, err)
	}
	select {
	case updated := <-h.RemoteJobUpdates():
		if updated.ID != op.ID || updated.Status != operation.StatusCompleted {
			t.Fatalf("operation was not completed: %+v", updated)
		}
	case <-time.After(time.Second):
		t.Fatal("answered operation was left waiting")
	}
}

type concurrentFailureClient struct {
	calls      atomic.Int32
	marker     string
	badHistory atomic.Bool
}

func (c *concurrentFailureClient) Close() error { return nil }
func (c *concurrentFailureClient) Respond(_ context.Context, r llm.Request, _ llm.RequestOptions) (llm.Response, error) {
	n := c.calls.Add(1)
	if n == 1 {
		args, _ := json.Marshal(map[string]string{"command": "printf x >> '" + c.marker + "'; exec sleep 30"})
		return llm.Response{ID: uuid.New().String(), Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "active", Name: "Bash", Arguments: string(args)}}}}, nil
	}
	if n == 2 {
		return llm.Response{ID: uuid.New().String(), Failure: &llm.Failure{Code: "server_error", Message: "failure during parallel tool"}, Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "NEVER_RUN", Name: "Bash", Arguments: `{"command":"exit 99"}`}}}}, nil
	}
	encoded, _ := json.Marshal(r.Input)
	if strings.Contains(string(encoded), "NEVER_RUN") {
		c.badHistory.Store(true)
	}
	return llm.Response{ID: uuid.New().String(), Output: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleAssistant, Text: "Reviewed the interruption; no action was replayed."}}}}, nil
}
func TestProviderFailureSettlesParallelOperationsBeforeRetry(t *testing.T) {
	a, stop, _, _ := testApp(t, t.TempDir(), false)
	defer stop()
	client := &concurrentFailureClient{marker: filepath.Join(t.TempDir(), "executions")}
	a.makeClient = func(sessionConfig, credential) (agentrunner.Client, string, error) { return client, "fixture", nil }
	result, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fixture"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(result.(map[string]string)["sessionId"])
	send := func(prompt string) {
		t.Helper()
		if _, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: prompt})}); err != nil {
			t.Fatal(err)
		}
	}
	send("Start the tool")
	waitFor(t, func() bool { b, _ := os.ReadFile(client.marker); return string(b) == "x" })
	send("Continue planning while the tool runs")
	waitFor(t, func() bool {
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		out, _ := a.events.outcome(id, false)
		return run == nil && out.State == "failed"
	})
	cancelled := false
	for _, item := range allItems(t, a, id) {
		if value, ok := item.Data.(sessionstore.ToolCallStatus); ok {
			for _, op := range value.Operations {
				if op.Status == operation.StatusCanceled {
					cancelled = true
				}
			}
		}
	}
	if !cancelled {
		t.Fatal("Fatal failure did not persist operation cancellation")
	}
	entries, _ := a.events.entries(id, 0, 1000)
	var sequence uint64
	for _, entry := range entries {
		var p map[string]any
		_ = json.Unmarshal(entry.Payload, &p)
		if entry.Event == "session.item" && prop(prop(prop(p, "Data"), "Response"), "Failure") != nil {
			sequence = entry.Sequence
		}
	}
	if _, err = a.dispatch(request{Version: 1, Method: "session.retry", Params: mustJSON(t, map[string]any{"sessionId": id, "messageId": uuid.New().String(), "failureSequence": sequence})}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		out, _ := a.events.outcome(id, true)
		return out.State == "completed" || out.State == "completed_with_warnings"
	})
	if client.calls.Load() != 3 || client.badHistory.Load() {
		t.Fatalf("Retry duplicated inference or included failed tool calls: %d, %v", client.calls.Load(), client.badHistory.Load())
	}
	b, _ := os.ReadFile(client.marker)
	if string(b) != "x" {
		t.Fatal("The interrupted command was replayed")
	}
}
func TestQuestionShapeBoundsAndLegacyCompatibility(t *testing.T) {
	for n := 0; n <= 4; n++ {
		args := workflowArgs{}
		for i := 0; i < n; i++ {
			args.Questions = append(args.Questions, questionItem{Title: "Choose"})
		}
		err := normalizeQuestions(&args)
		if (err == nil) != (n >= 1 && n <= 3) {
			t.Fatalf("question count %d: %v", n, err)
		}
	}
	legacy := workflowArgs{Question: "Choose a target", Choices: []string{"Alpha", "Beta"}}
	if err := normalizeQuestions(&legacy); err != nil || legacy.Mode != "required" || legacy.Questions[0].Choices[0].ID != "1" {
		t.Fatal(legacy, err)
	}
	duplicate := workflowArgs{Questions: []questionItem{{ID: "same", Title: "A"}, {ID: "same", Title: "B"}}}
	if normalizeQuestions(&duplicate) == nil {
		t.Fatal("Duplicate question IDs accepted")
	}
}

type backgroundQuestionClient struct {
	calls       atomic.Int32
	started     chan struct{}
	release     chan struct{}
	interrupted atomic.Bool
	seen        atomic.Bool
}

func (c *backgroundQuestionClient) Close() error { return nil }
func (c *backgroundQuestionClient) Respond(ctx context.Context, request llm.Request, _ llm.RequestOptions) (llm.Response, error) {
	n := c.calls.Add(1)
	if n == 1 {
		return llm.Response{ID: uuid.New().String(), Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "q", Name: "RequestInput", Arguments: `{"mode":"background","question":"Optional preference?"}`}}}}, nil
	}
	if n == 2 {
		close(c.started)
		select {
		case <-c.release:
		case <-ctx.Done():
			c.interrupted.Store(true)
			return llm.Response{}, ctx.Err()
		}
	}
	encoded, _ := json.Marshal(request.Input)
	if strings.Contains(string(encoded), "Retained preference") {
		c.seen.Store(true)
	}
	return llm.Response{ID: uuid.New().String(), Output: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleAssistant, Text: "Continued work"}}}}, nil
}
func TestBackgroundAnswerWaitsForModelBoundary(t *testing.T) {
	a, stop, _, _ := testApp(t, t.TempDir(), false)
	defer stop()
	client := &backgroundQuestionClient{started: make(chan struct{}), release: make(chan struct{})}
	a.makeClient = func(sessionConfig, credential) (agentrunner.Client, string, error) { return client, "fixture", nil }
	result, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fixture"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(result.(map[string]string)["sessionId"])
	if _, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "Start background question"})}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-client.started:
	case <-time.After(10 * time.Second):
		t.Fatal("Background question blocked model")
	}
	rows, err := a.questions.list(id, "")
	if err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	q := rows[0]
	if _, err = a.dispatch(request{Version: 1, Method: "question.answer", Params: mustJSON(t, answerQuestionParams{SessionID: string(id), ID: q.ID, Revision: 1, SubmissionID: uuid.New().String(), Answers: []questionAnswer{{QuestionID: "q1", Text: "Retained preference"}}})}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	if client.interrupted.Load() || client.calls.Load() != 2 {
		t.Fatal("Background answer interrupted active inference")
	}
	close(client.release)
	waitFor(t, func() bool { return client.seen.Load() })
	if client.interrupted.Load() {
		t.Fatal("Inference was interrupted")
	}
}

type failingQuestionClient struct {
	calls      atomic.Int32
	answerSeen atomic.Bool
}

func (c *failingQuestionClient) Close() error { return nil }
func (c *failingQuestionClient) Respond(_ context.Context, request llm.Request, _ llm.RequestOptions) (llm.Response, error) {
	n := c.calls.Add(1)
	if n == 1 {
		return llm.Response{ID: uuid.New().String(), Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "q", Name: "RequestInput", Arguments: `{"questions":[{"id":"choice","title":"Target?","choices":[{"id":"a","label":"Alpha"}]}]}`}}}}, nil
	}
	encoded, _ := json.Marshal(request.Input)
	if strings.Contains(string(encoded), "Alpha") {
		c.answerSeen.Store(true)
	}
	if n == 2 {
		return llm.Response{ID: uuid.New().String(), Failure: &llm.Failure{Code: "server_error", Message: "JSON error injected into SSE stream"}}, nil
	}
	return llm.Response{ID: uuid.New().String(), Stop: llm.StopComplete, Output: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleAssistant, Text: "Recovered using accepted answer"}}}}, nil
}
func TestAcceptedAnswerSurvivesProviderFailureAndExplicitRetry(t *testing.T) {
	a, stop, _, _ := testApp(t, t.TempDir(), false)
	defer stop()
	client := &failingQuestionClient{}
	a.makeClient = func(sessionConfig, credential) (agentrunner.Client, string, error) { return client, "fixture", nil }
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fixture", WorkspaceID: "workspace"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	_, err = a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: uuid.New().String(), Prompt: "Start"})})
	if err != nil {
		t.Fatal(err)
	}
	var q questionRequest
	waitFor(t, func() bool {
		rows, _ := a.questions.list(id, "")
		if len(rows) == 1 {
			q = rows[0]
			return true
		}
		return false
	})
	p := answerQuestionParams{SessionID: string(id), WorkspaceID: "workspace", ID: q.ID, Revision: 1, SubmissionID: uuid.New().String(), Answers: []questionAnswer{{QuestionID: "choice", ChoiceID: "a"}}}
	defer func() {
		if !t.Failed() {
			return
		}
		out, readErr := a.events.outcome(id, false)
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		busy, stopping := false, false
		if run != nil {
			busy, stopping = run.busy.Load(), run.stopping.Load()
		}
		t.Logf("provider failure diagnostics: outcome=%+v readError=%v running=%t busy=%t stopping=%t calls=%d answerSeen=%t", out, readErr, run != nil, busy, stopping, client.calls.Load(), client.answerSeen.Load())
		entries, _ := a.events.entries(id, 0, 1000)
		for _, entry := range entries[max(0, len(entries)-12):] {
			t.Logf("event %d %s source=%d: %.2048s", entry.Sequence, entry.Event, entry.SourceSequence, entry.Payload)
		}
	}()
	for range 2 {
		if _, err = a.dispatch(request{Version: 1, Method: "question.answer", Params: mustJSON(t, p)}); err != nil {
			t.Fatal(err)
		}
	}
	waitFor(t, func() bool {
		out, _ := a.events.outcome(id, false)
		a.mu.Lock()
		running := a.running[id] != nil
		a.mu.Unlock()
		return out.State == "failed" && !running
	})
	if !client.answerSeen.Load() {
		t.Fatal("Provider did not receive the accepted answer")
	}
	rows, _ := a.questions.list(id, "")
	if rows[0].State != "answered" {
		t.Fatal(rows)
	}
	entries, _ := a.events.entries(id, 0, 1000)
	var failure uint64
	for _, event := range entries {
		var p map[string]any
		_ = json.Unmarshal(event.Payload, &p)
		if event.Event == "session.item" && prop(prop(prop(p, "Data"), "Response"), "Failure") != nil {
			failure = event.Sequence
		}
	}
	if failure == 0 {
		t.Fatal("Failure was not persisted")
	}
	message := uuid.New().String()
	params := mustJSON(t, map[string]any{"sessionId": id, "failureSequence": failure, "messageId": message})
	for range 2 {
		if _, err = a.dispatch(request{Version: 1, Method: "session.retry", Params: params}); err != nil {
			t.Fatal(err)
		}
	}
	waitFor(t, func() bool { out, _ := a.events.outcome(id, true); return out.State == "completed" })
	if client.calls.Load() != 3 {
		t.Fatalf("Retry replayed model work: %d", client.calls.Load())
	}
	rows, _ = a.questions.list(id, "")
	if len(rows) != 1 || rows[0].SubmissionID != p.SubmissionID {
		t.Fatal("Question was replayed")
	}
}
