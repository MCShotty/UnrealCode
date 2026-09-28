package main

import (
	"context"
	"github.com/unreallabsai/unreal-agent/cmd/internal/agentrunner"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"sync/atomic"
	"testing"
	"uuid"
)

type questionClient struct{ calls atomic.Int32 }

func (c *questionClient) Close() error { return nil }
func (c *questionClient) Respond(ctx context.Context, _ llm.Request, _ llm.RequestOptions) (llm.Response, error) {
	if c.calls.Add(1) == 1 {
		return llm.Response{ID: uuid.New().String(), Stop: llm.StopComplete, Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "question", Name: "RequestInput", Arguments: `{"question":"Choose the target"}`}}}}, nil
	}
	return llm.Response{ID: uuid.New().String(), Stop: llm.StopComplete, Output: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleAssistant, Text: "Done"}}}}, nil
}
func TestRetriedMessageDoesNotAnswerPendingQuestion(t *testing.T) {
	a, cancel, _, _ := testApp(t, t.TempDir(), false)
	defer cancel()
	client := &questionClient{}
	a.makeClient = func(_ sessionConfig, _ credential) (agentrunner.Client, string, error) { return client, "fixture", nil }
	created, err := a.dispatch(request{Version: 1, Method: "session.create", Params: mustJSON(t, createParams{Config: sessionConfig{Mode: "agent", Provider: "test", Model: "fixture"}})})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(created.(map[string]string)["sessionId"])
	messageID := uuid.New().String()
	send := func(message string, prompt string) {
		t.Helper()
		_, err := a.dispatch(request{Version: 1, Method: "session.send", Params: mustJSON(t, sendParams{SessionID: string(id), MessageID: message, Prompt: prompt})})
		if err != nil {
			t.Fatal(err)
		}
	}
	send(messageID, "Begin")
	a.mu.Lock()
	run := a.running[id]
	a.mu.Unlock()
	waitFor(t, func() bool {
		run.workflow.mu.Lock()
		defer run.workflow.mu.Unlock()
		return len(run.workflow.waiting) == 1
	})
	send(messageID, "Begin")
	run.workflow.mu.Lock()
	pending := len(run.workflow.waiting)
	run.workflow.mu.Unlock()
	if pending != 1 {
		t.Fatal("duplicate message answered a pending question")
	}
	send(uuid.New().String(), "Use Alpha")
	if client.calls.Load() != 1 {
		t.Fatal("ordinary steering resumed required question")
	}
	questions, err := a.questions.list(id, "")
	if err != nil || len(questions) != 1 {
		t.Fatalf("questions: %v %v", questions, err)
	}
	if questions[0].State != "pending" {
		t.Fatal("ordinary steering answered question")
	}
	_, err = a.dispatch(request{Version: 1, Method: "question.answer", Params: mustJSON(t, answerQuestionParams{SessionID: string(id), ID: questions[0].ID, Revision: 1, SubmissionID: uuid.New().String(), Answers: []questionAnswer{{QuestionID: "q1", Text: "Use Alpha"}}})})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		run.workflow.mu.Lock()
		defer run.workflow.mu.Unlock()
		return len(run.workflow.waiting) == 0
	})
}
