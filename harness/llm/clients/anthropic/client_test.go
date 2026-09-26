package anthropic

import (
	"context"
	"encoding/json"
	"github.com/unreallabsai/unreal-agent/harness/contextbuilder"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unreallabsai/unreal-agent/harness/llm"
)

func TestClaudeMessagesToolRoundTrip(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("anthropic-version") != "2023-06-01" || r.Header.Get("x-api-key") != "test-token" {
			t.Errorf("unexpected Claude request: %s %s", r.Method, r.URL.Path)
		}
		var request apiRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.System != "Follow project instructions" || len(request.Tools) != 1 || len(request.Messages) != 3 {
			t.Errorf("unexpected request: %#v", request)
		}
		if request.Messages[2].Role != "user" || request.Messages[2].Content[0]["type"] != "tool_result" {
			t.Errorf("tool result not replayed as user content: %#v", request.Messages)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("anthropic-ratelimit-input-tokens-limit", "200000")
		w.Header().Set("anthropic-ratelimit-input-tokens-remaining", "180000")
		_, _ = w.Write([]byte(`{"id":"msg_test","stop_reason":"tool_use","content":[{"type":"text","text":"Checking."},{"type":"tool_use","id":"toolu_next","name":"Bash","input":{"command":"pwd"}}],"usage":{"input_tokens":11,"cache_read_input_tokens":3,"cache_creation_input_tokens":2,"output_tokens":4}}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{APIKey: "test-token", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	response, err := client.Respond(context.Background(), llm.Request{
		Model: llm.Model{ID: "claude-sonnet-5"},
		Input: []llm.Item{
			{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleSystem, Text: "Follow project instructions"}},
			{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleUser, Text: "Where am I?"}},
			{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "toolu_earlier", Name: "Bash", Arguments: `{"command":"pwd"}`}},
			{Type: llm.ItemToolResult, Data: llm.ToolResult{CallID: "toolu_earlier", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "/workspace"}}}},
		},
		Tools: []llm.Tool{{Type: llm.ToolFunction, Name: "Bash", Parameters: map[string]any{"type": "object"}}},
	}, llm.RequestOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Output) != 2 || response.Output[1].Type != llm.ItemToolCall || response.Output[1].Data.(llm.ToolCall).CallID != "toolu_next" {
		t.Fatalf("unexpected output: %#v", response.Output)
	}
	if response.Usage.InputTokens != 16 || response.Usage.CachedInputTokens != 3 || response.Usage.OutputTokens != 4 {
		t.Fatalf("unexpected usage: %#v", response.Usage)
	}
	if response.RateLimits["anthropic-ratelimit-input-tokens-remaining"] != "180000" {
		t.Fatalf("missing rate-limit header: %#v", response.RateLimits)
	}
}

func TestClaudeViewImageResult(t *testing.T) {
	request, err := buildRequest(llm.Request{Model: llm.Model{ID: "claude-sonnet-5"}, Input: []llm.Item{{Data: llm.ToolResult{CallID: "image-call", Output: []llm.ToolResultOutput{
		{Kind: llm.ToolResultText, Value: "A project image"},
		{Kind: llm.ToolResultImage, Value: "data:image/png;base64,aGVsbG8="},
	}}}}})
	if err != nil {
		t.Fatal(err)
	}
	block := request.Messages[0].Content[0]
	content := block["content"].([]contentBlock)
	source := content[1]["source"].(map[string]any)
	if source["media_type"] != "image/png" || source["data"] != "aGVsbG8=" {
		t.Fatalf("image not mapped: %#v", source)
	}
}

func TestClaudeKeyRequired(t *testing.T) {
	if _, err := NewClient(Config{}); err == nil {
		t.Fatal("missing key was accepted")
	}
}

func TestClaudeSteeringKeepsToolResultsBeforeUserText(t *testing.T) {
	builder := contextbuilder.NewBuilder()
	builder.SetModel(llm.Model{ID: "fixture"})
	if err := builder.AddExternalInput(inbox.Input{ID: "first", Kind: inbox.InputExternal, Payload: []byte(`"Start"`)}); err != nil {
		t.Fatal(err)
	}
	builder.Commit()
	builder.AddModelResponse(llm.Response{Output: []llm.Item{{Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: "slow", Name: "Bash", Arguments: `{}`}}}})
	if err := builder.AddExternalInput(inbox.Input{ID: "steer", Kind: inbox.InputExternal, Payload: []byte(`"Also check errors"`)}); err != nil {
		t.Fatal(err)
	}
	builder.AddToolResult("slow", nil, true)
	built, err := builder.Build()
	if err != nil {
		t.Fatal(err)
	}
	request, err := buildRequest(built.Request)
	if err != nil {
		t.Fatal(err)
	}
	last := request.Messages[len(request.Messages)-1]
	if last.Content[0]["type"] != "tool_result" {
		t.Fatalf("steering precedes required tool result: %#v", last)
	}
}

func TestClaudeLateToolCompletionIsAnUpdateNotASecondToolResult(t *testing.T) {
	request, err := buildRequest(llm.Request{Model: llm.Model{ID: "fixture"}, Input: []llm.Item{
		{Data: llm.Message{Role: llm.RoleUser, Text: "Start"}},
		{Data: llm.ToolCall{CallID: "slow", Name: "Bash", Arguments: `{}`}},
		{Data: llm.ToolResult{CallID: "slow", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: contextbuilder.ToolCallRunningPayload}}}},
		{Data: llm.Message{Role: llm.RoleAssistant, Text: "Continuing independent work"}},
		{Data: llm.ToolResult{CallID: "slow", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "later output"}, {Kind: llm.ToolResultImage, Value: "data:image/png;base64,aGVsbG8="}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	native := 0
	for _, message := range request.Messages {
		for _, block := range message.Content {
			if block["type"] == "tool_result" {
				native++
			}
		}
	}
	if native != 1 {
		t.Fatalf("late result repeated native tool_result: %d", native)
	}
	last := request.Messages[len(request.Messages)-1]
	data, _ := json.Marshal(last)
	if !strings.Contains(string(data), "later output") || !strings.Contains(string(data), "image/png") {
		t.Fatalf("lost late content: %s", data)
	}
}
