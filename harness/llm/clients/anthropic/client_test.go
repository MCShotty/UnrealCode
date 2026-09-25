package anthropic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
