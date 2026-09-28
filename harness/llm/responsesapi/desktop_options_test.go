package responsesapi

import (
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"strings"
	"testing"
)

func TestDesktopSpeedAndUserImages(t *testing.T) {
	body, err := requestBody(llm.Request{Model: llm.Model{ID: "fixture", ServiceTier: "priority", ReasoningEffort: llm.ReasoningEffortHigh}, Input: []llm.Item{{Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleUser, Text: "Inspect", Images: []string{"data:image/png;base64,aW1hZ2U="}}}}}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{`"service_tier":"priority"`, `"effort":"high"`, `"type":"input_image"`, `data:image/png;base64,aW1hZ2U=`} {
		if !strings.Contains(string(body), value) {
			t.Fatalf("missing %s in %s", value, body)
		}
	}
	result, err := decodeResponse([]byte(`{"id":"response","status":"completed","service_tier":"default","output":[]}`))
	if err != nil || result.ServiceTier != "default" {
		t.Fatalf("must preserve reported downgrade: %+v %v", result, err)
	}
}
