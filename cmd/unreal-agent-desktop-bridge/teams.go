package main

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

const teamPlan operation.RemoteJobPlanType = "unrealcode.team"

var teamNames = []string{"TeamDispatch", "TeamStatus", "TeamSteer", "TeamCancel", "TeamWait", "TeamFollowUp"}

func teamTools(enabled bool) []tool.ExtraStaticTool {
	text := map[string]any{"type": "string"}
	definitions := []struct {
		name, description string
		properties        map[string]any
		required          []any
	}{
		{"TeamDispatch", "Dispatch a specialist only when the user enabled this task's team. Supply explicit ownership. Workers use isolated recorded snapshots, inherit restrictions, and cannot publish or delegate. Returns immediately after starting; inspect TeamStatus for findings. Changes require user integration.", map[string]any{"role": map[string]any{"type": "string", "enum": []any{"explorer", "implementer", "reviewer", "browser-tester"}}, "assignment": text, "ownership": map[string]any{"type": "array", "items": text}, "expectedResult": text, "acceptance": map[string]any{"type": "array", "items": text}}, []any{"role", "assignment", "ownership", "expectedResult", "acceptance"}},
		{"TeamStatus", "Read this task's specialists, bounded findings, usage and pending integration. Inspect at useful checkpoints; do not poll in a tight loop.", map[string]any{}, nil},
		{"TeamSteer", "Send a focused steering message to one active specialist in this task. Does not broaden its original permissions or ownership.", map[string]any{"workerId": text, "message": text}, []any{"workerId", "message"}},
		{"TeamCancel", "Cancel one specialist in this task while retaining its worktree, session and evidence.", map[string]any{"workerId": text}, []any{"workerId"}},
		{"TeamWait", "Wait up to 30 seconds for specialist progress without blocking other tools. Returns current findings; do useful independent work first.", map[string]any{}, []any{}},
		{"TeamFollowUp", "Continue a retained specialist within its existing assignment, ownership and restrictions. Does not create nested workers.", map[string]any{"workerId": text, "message": text}, []any{"workerId", "message"}},
	}
	result := make([]tool.ExtraStaticTool, 0, len(definitions))
	for _, d := range definitions {
		if d.required == nil {
			d.required = []any{}
		}
		result = append(result, tool.ExtraStaticTool{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: d.name, Description: d.description, Parameters: map[string]any{"type": "object", "properties": d.properties, "required": d.required, "additionalProperties": false}}}, Translator: teamTranslator{name: d.name, enabled: enabled}})
	}
	return result
}

type teamTranslator struct {
	name    string
	enabled bool
}

func (t teamTranslator) Translate(ctx tool.Context, call llm.ToolCall) tool.CallStatus {
	if !t.enabled {
		return tool.CallStatus{Error: "Specialist delegation is not enabled for this session; nested delegation is forbidden"}
	}
	var args map[string]any
	if len(call.Arguments) > 32*1024 || json.Unmarshal([]byte(call.Arguments), &args) != nil || args == nil {
		return tool.CallStatus{Error: "Team arguments must be a JSON object below 32 KB"}
	}
	data, _ := json.Marshal(mcpInput{Tool: t.name, Arguments: args})
	spec, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: teamPlan, Version: 1, Data: jsontext.Value(data)})
	if err != nil {
		return tool.CallStatus{Error: err.Error()}
	}
	return tool.CallStatus{WaitingFor: []operation.ID{ctx.Submit(spec)}}
}
func (t teamTranslator) TranslateResult(id string, status tool.CallStatus, values []operation.Operation) (llm.ToolResult, error) {
	return (decisionToolTranslator{}).TranslateResult(id, status, values)
}

// Only opted-in task sessions pay for the host permit round trip. The main
// process owns limits; provider retries inside Respond count as one logical call.
func (a *app) modelPermit(ctx context.Context, id session.ID, workspace, modelRequestID string) error {
	requestID := uuid.New().String()
	op := operation.ID("model:" + modelRequestID)
	reply := make(chan hostReply, 1)
	a.host.mu.Lock()
	if a.host.pending == nil {
		a.host.pending = map[string]hostPending{}
	}
	a.host.pending[requestID] = hostPending{session: id, operation: op, reply: reply}
	a.host.mu.Unlock()
	defer func() { a.host.mu.Lock(); delete(a.host.pending, requestID); a.host.mu.Unlock() }()
	a.events.enqueue(id, "host.model", map[string]any{"requestId": requestID, "sessionId": id, "operationId": op, "workspaceId": workspace, "tool": "ModelPermit", "arguments": map[string]any{"modelRequestId": modelRequestID}})
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	select {
	case result := <-reply:
		if result.Error {
			return errors.New(result.Text)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return errors.New("Task budget service unavailable; reconnect before resuming")
	}
}
