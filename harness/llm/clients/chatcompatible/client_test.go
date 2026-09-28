package chatcompatible

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSteeringAndLateResultsKeepValidToolPairs(t *testing.T) {
	request, err := buildRequest(llm.Request{Model: llm.Model{ID: "fixture"}, Input: []llm.Item{
		{Data: llm.Message{Role: llm.RoleUser, Text: "Start"}},
		{Data: llm.ToolCall{CallID: "a", Name: "Bash", Arguments: `{}`}},
		{Data: llm.ToolCall{CallID: "b", Name: "Bash", Arguments: `{}`}},
		{Data: llm.Message{Role: llm.RoleUser, Text: "Steering"}},
		{Data: llm.ToolResult{CallID: "a", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "running"}}}},
		{Data: llm.ToolResult{CallID: "b", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "done"}}}},
		{Data: llm.Message{Role: llm.RoleAssistant, Text: "Continuing"}},
		{Data: llm.ToolResult{CallID: "a", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "late result"}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if request.Messages[2].Role != "tool" || request.Messages[3].Role != "tool" {
		t.Fatalf("steering separated tool replies: %#v", request.Messages)
	}
	count := 0
	for _, message := range request.Messages {
		if message.Role == "tool" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("unexpected repeated tool reply: %d", count)
	}
	data, _ := json.Marshal(request)
	if !strings.Contains(string(data), "late result") || !strings.Contains(string(data), "Steering") {
		t.Fatal("lost steering or late result")
	}
}

func TestViewImageIsNotSilentlyDiscarded(t *testing.T) {
	request, err := buildRequest(llm.Request{Model: llm.Model{ID: "fixture"}, Input: []llm.Item{
		{Data: llm.ToolCall{CallID: "image", Name: "ViewImage", Arguments: `{}`}},
		{Data: llm.ToolResult{CallID: "image", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultImage, Value: "data:image/png;base64,aGVsbG8="}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(request)
	if !strings.Contains(string(encoded), "image_url") || !strings.Contains(string(encoded), "data:image/png;base64,aGVsbG8=") {
		t.Fatalf("image lost: %s", encoded)
	}
}

func TestReportedReasoningTokensAndRateLimitsArePreserved(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-ratelimit-remaining-tokens", "900")
		_, _ = w.Write([]byte(`{"id":"fixture","choices":[{"finish_reason":"stop","message":{"content":"OK"}}],"usage":{"prompt_tokens":20,"completion_tokens":12,"completion_tokens_details":{"reasoning_tokens":8}}}`))
	}))
	defer server.Close()
	client, err := NewClient("", server.URL, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	response, err := client.Respond(context.Background(), llm.Request{Model: llm.Model{ID: "fixture"}}, llm.RequestOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if response.Usage.ReasoningTokens != 8 || response.Usage.OutputTokens != 12 {
		t.Fatalf("lost usage: %+v", response.Usage)
	}
	if response.RateLimits["x-ratelimit-remaining-tokens"] != "900" {
		t.Fatalf("lost limits: %+v", response.RateLimits)
	}
}

func TestBuildRequestIncludesConfiguredReasoningEffort(t *testing.T) {
	request, err := buildRequest(llm.Request{
		Model: llm.Model{ID: "fixture", ReasoningEffort: llm.ReasoningEffortLow},
		Input: []llm.Item{{Data: llm.Message{Role: llm.RoleUser, Text: "Reply with OK."}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"reasoning_effort":"low"`) {
		t.Fatalf("reasoning effort missing from local request: %s", encoded)
	}
}

func TestBuildRequestRejectsUnsupportedReasoningEffort(t *testing.T) {
	_, err := buildRequest(llm.Request{Model: llm.Model{ID: "fixture", ReasoningEffort: "turbo"}})
	if err == nil || !strings.Contains(err.Error(), `unsupported reasoning effort "turbo"`) {
		t.Fatalf("unsupported reasoning effort error = %v", err)
	}
}

func TestBuildRequestUsesBoundedDefaultOutputTokens(t *testing.T) {
	request, err := buildRequest(llm.Request{Model: llm.Model{ID: "fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	if request.MaxTokens == nil || *request.MaxTokens != 2048 {
		t.Fatalf("default max tokens = %v, want 2048", request.MaxTokens)
	}
}

func TestBuildRequestPreservesExplicitOutputTokenLimit(t *testing.T) {
	limit := int64(8192)
	request, err := buildRequest(llm.Request{Model: llm.Model{ID: "fixture", MaxOutputTokens: &limit}})
	if err != nil {
		t.Fatal(err)
	}
	if request.MaxTokens == nil || *request.MaxTokens != limit {
		t.Fatalf("explicit max tokens = %v, want %d", request.MaxTokens, limit)
	}
}
