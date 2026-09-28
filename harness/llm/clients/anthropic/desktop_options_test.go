package anthropic

import (
	"context"
	"encoding/json"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopFastImagesAndActualSpeed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["speed"] != "fast" || r.Header.Get("anthropic-beta") != "fast-mode-2026-02-01" {
			t.Error("missing fast configuration")
		}
		content := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
		if len(content) != 2 || content[1].(map[string]any)["type"] != "image" {
			t.Error("image absent")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"test","stop_reason":"end_turn","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":5,"output_tokens":1,"speed":"standard"}}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{APIKey: "fixture", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	response, err := client.Respond(context.Background(), llm.Request{Model: llm.Model{ID: "fixture", ServiceTier: "priority"}, Input: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleUser, Text: "Inspect", Images: []string{"data:image/png;base64,aW1hZ2U="}}}}}, llm.RequestOptions{})
	if err != nil || response.ServiceTier != "standard" {
		t.Fatalf("actual speed not retained: %+v %v", response, err)
	}
}
