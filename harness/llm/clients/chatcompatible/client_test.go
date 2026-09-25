package chatcompatible

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unreallabsai/unreal-agent/harness/llm"
)

func TestToolRoundTripAndMeasuredUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected local request: %s", r.URL.Path)
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			return
		}
		messages := input["messages"].([]any)
		if len(messages) != 3 || messages[2].(map[string]any)["role"] != "tool" {
			t.Errorf("tool result not mapped: %#v", messages)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","choices":[{"finish_reason":"tool_calls","message":{"content":"I will inspect it.","tool_calls":[{"id":"call-2","function":{"name":"Bash","arguments":"{\"command\":\"pwd\"}"}}]}}],"usage":{"prompt_tokens":34,"completion_tokens":9,"prompt_tokens_details":{"cached_tokens":4}}}`))
	}))
	defer server.Close()
	client, err := NewClient("", server.URL+"/v1", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	response, err := client.Respond(context.Background(), llm.Request{Model: llm.Model{ID: "local-model"}, Input: []llm.Item{
		{Data: llm.Message{Role: llm.RoleSystem, Text: "system"}},
		{Data: llm.ToolCall{CallID: "call-1", Name: "Bash", Arguments: `{}`}},
		{Data: llm.ToolResult{CallID: "call-1", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "ok"}}}},
	}}, llm.RequestOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Output) != 2 || response.Output[1].Data.(llm.ToolCall).CallID != "call-2" {
		t.Fatalf("tool output: %#v", response.Output)
	}
	if response.Usage.InputTokens != 34 || response.Usage.OutputTokens != 9 || response.Usage.CachedInputTokens != 4 {
		t.Fatalf("usage: %#v", response.Usage)
	}
}
