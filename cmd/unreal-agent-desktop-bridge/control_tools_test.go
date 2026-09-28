package main

import (
	"encoding/base64"
	"encoding/json/v2"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/tool"
	"strings"
	"testing"
)

type controlContext struct{ spec operation.Spec }

func (c *controlContext) Submit(spec operation.Spec) operation.ID { c.spec = spec; return "image" }
func TestBrowserScreenshotSurvivesOperationStorage(t *testing.T) {
	translator := controlTranslator{name: "Browser"}
	ctx := &controlContext{}
	status := translator.Translate(ctx, llm.ToolCall{CallID: "call", Arguments: `{"type":"screenshot"}`})
	current := operation.Operation{ID: "image", Type: ctx.spec.Type, Version: ctx.spec.Version, MaxOutputLength: ctx.spec.MaxOutputLength, State: ctx.spec.State, Status: operation.StatusReady}
	state, err := operation.DecodeRemoteJobState(current)
	if err != nil {
		t.Fatal(err)
	}
	image := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("pixel", 18000)))
	body, _ := json.Marshal(map[string]string{"kind": "unrealcode.browser.image", "image": image})
	state.TerminalResult = string(body)
	step, err := operation.UpdateRemoteJob(current, state, operation.StatusCompleted)
	if err != nil {
		t.Fatal(err)
	}
	result, err := translator.TranslateResult("call", status, []operation.Operation{*step.Operation})
	if err != nil || len(result.Output) != 2 || result.Output[1].Value != image {
		t.Fatalf("screenshot was damaged: %v", err)
	}
	state.TerminalResult = `{"kind":"unrealcode.browser.image","image":"data:image/png;base64,AAA...truncated...BBB"}`
	step, err = operation.UpdateRemoteJob(current, state, operation.StatusCompleted)
	if err != nil {
		t.Fatal(err)
	}
	result, err = translator.TranslateResult("call", tool.CallStatus{}, []operation.Operation{*step.Operation})
	if err != nil || len(result.Output) != 1 || result.Output[0].Kind != llm.ToolResultText || !strings.Contains(result.Output[0].Value, "truncated") {
		t.Fatal("legacy damaged screenshot must not reach a provider")
	}
}
