package main

import (
	"context"
	"encoding/json"
	"encoding/json/jsontext"
	"errors"
	"fmt"
	"sync"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

const (
	decisionToolName                             = "DecisionBatch"
	entityToolName                               = "EntityExtract"
	decisionPlanType operation.RemoteJobPlanType = "unrealcode.decision"
	entityPlanType   operation.RemoteJobPlanType = "unrealcode.entities"
)

func decisionTools() []tool.ExtraStaticTool {
	return []tool.ExtraStaticTool{
		{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: decisionToolName,
			Description: "Evaluate a batch of bounded semantic Choice, Noul, or Score questions using the globally selected decision engine. Use focused evidence and preserve uncertainty; do not ask this tool to write code, plan, calculate, or authorize actions.",
			Parameters: map[string]any{"type": "object", "properties": map[string]any{
				"state":      map[string]any{"description": "Focused text or JSON evidence"},
				"questions":  map[string]any{"type": "object", "description": "Map of stable IDs to typed questions. Choice criteria is an option map; Score criteria is an ordered array; Noul criteria is optional and, if present, must be an object with true/false descriptions. Put other Noul guidance in instructions."},
				"sourceRefs": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			}, "required": []any{"state", "questions"}}}}, Translator: decisionToolTranslator{kind: decisionPlanType}},
		{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: entityToolName,
			Description: "Extract labeled entity spans from focused text using the optional local GLiNER model. This is extraction, not a Choice/Noul/Score decision.",
			Parameters: map[string]any{"type": "object", "properties": map[string]any{
				"text":   map[string]any{"type": "string"},
				"labels": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			}, "required": []any{"text", "labels"}}}}, Translator: decisionToolTranslator{kind: entityPlanType}},
	}
}

type decisionToolTranslator struct{ kind operation.RemoteJobPlanType }

func (translator decisionToolTranslator) Translate(ctx tool.Context, call llm.ToolCall) tool.CallStatus {
	if len(call.Arguments) == 0 || len(call.Arguments) > 256*1024 || !json.Valid([]byte(call.Arguments)) {
		return tool.CallStatus{Error: "Decision tool arguments must be valid JSON below 256 KB"}
	}
	if translator.kind == decisionPlanType {
		var batch decisionBatch
		if err := json.Unmarshal([]byte(call.Arguments), &batch); err != nil {
			return tool.CallStatus{Error: err.Error()}
		}
		if err := validateDecisionBatch(batch); err != nil {
			return tool.CallStatus{Error: err.Error()}
		}
	} else {
		var request struct {
			Text   string   `json:"text"`
			Labels []string `json:"labels"`
		}
		if err := json.Unmarshal([]byte(call.Arguments), &request); err != nil || request.Text == "" || len(request.Labels) == 0 {
			return tool.CallStatus{Error: "EntityExtract needs text and labels"}
		}
	}
	spec, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: translator.kind, Version: 1, Data: jsontext.Value(call.Arguments)})
	if err != nil {
		return tool.CallStatus{Error: err.Error()}
	}
	return tool.CallStatus{WaitingFor: []operation.ID{ctx.Submit(spec)}}
}

func (translator decisionToolTranslator) TranslateResult(callID string, status tool.CallStatus, values []operation.Operation) (llm.ToolResult, error) {
	text := status.Error
	if text == "" {
		if len(values) != 1 {
			return llm.ToolResult{}, fmt.Errorf("decision tool %q expected one operation, got %d", callID, len(values))
		}
		state, err := operation.DecodeRemoteJobState(values[0])
		if err != nil {
			return llm.ToolResult{}, err
		}
		if values[0].Status == operation.StatusCompleted {
			text = state.TerminalResult
		} else if state.TerminalError != "" {
			text = state.TerminalError
		} else {
			text = string(values[0].Status)
		}
	}
	return llm.ToolResult{CallID: callID, Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: text}}}, nil
}

type decisionJobHandler struct {
	ctx     context.Context
	runtime *decisionRuntime
	kind    operation.RemoteJobPlanType
	updates chan operation.Operation
	mu      sync.Mutex
	cancels map[operation.ID]context.CancelFunc
}

func newDecisionJobHandler(ctx context.Context, runtime *decisionRuntime, kind operation.RemoteJobPlanType) *decisionJobHandler {
	return &decisionJobHandler{ctx: ctx, runtime: runtime, kind: kind, updates: make(chan operation.Operation, 32), cancels: make(map[operation.ID]context.CancelFunc)}
}

func (handler *decisionJobHandler) RemoteJobPlanType() operation.RemoteJobPlanType {
	return handler.kind
}
func (handler *decisionJobHandler) RemoteJobPlanVersion() operation.RemoteJobPlanVersion { return 1 }
func (handler *decisionJobHandler) RemoteJobUpdates() <-chan operation.Operation {
	return handler.updates
}

func (handler *decisionJobHandler) AddRemoteJob(current operation.Operation) error {
	state, err := operation.DecodeRemoteJobState(current)
	if err != nil || state.Plan.Type != handler.kind {
		return errors.New("unsupported decision operation")
	}
	ctx, cancel := context.WithCancel(handler.ctx)
	handler.mu.Lock()
	handler.cancels[current.ID] = cancel
	handler.mu.Unlock()
	go handler.execute(ctx, current, state)
	return nil
}

func (handler *decisionJobHandler) CancelRemoteJob(id operation.ID, _ string) error {
	handler.mu.Lock()
	cancel := handler.cancels[id]
	handler.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (handler *decisionJobHandler) execute(ctx context.Context, current operation.Operation, state operation.RemoteJobState) {
	defer func() {
		handler.mu.Lock()
		if cancel := handler.cancels[current.ID]; cancel != nil {
			cancel()
			delete(handler.cancels, current.ID)
		}
		handler.mu.Unlock()
	}()
	awaiting, err := operation.UpdateRemoteJob(current, state, operation.StatusAwaiting)
	if err != nil {
		return
	}
	if !handler.publish(ctx, *awaiting.Operation) {
		return
	}
	current = *awaiting.Operation
	var result any
	if handler.kind == decisionPlanType {
		var batch decisionBatch
		err = json.Unmarshal(state.Plan.Data, &batch)
		if err == nil {
			result, err = handler.runtime.evaluate(ctx, batch)
		}
	} else {
		var request struct {
			Text   string   `json:"text"`
			Labels []string `json:"labels"`
		}
		err = json.Unmarshal(state.Plan.Data, &request)
		if err == nil {
			result, err = handler.runtime.extract(ctx, request.Text, request.Labels)
		}
	}
	if ctx.Err() != nil {
		step, cancelErr := operation.CancelRemoteJob(current)
		if cancelErr == nil {
			handler.publish(handler.ctx, *step.Operation)
		}
		return
	}
	if err != nil {
		step, failErr := operation.FailRemoteJob(current, err)
		if failErr == nil {
			handler.publish(handler.ctx, *step.Operation)
		}
		return
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return
	}
	state.TerminalResult = string(encoded)
	step, err := operation.UpdateRemoteJob(current, state, operation.StatusCompleted)
	if err == nil {
		handler.publish(handler.ctx, *step.Operation)
	}
}

func (handler *decisionJobHandler) publish(ctx context.Context, value operation.Operation) bool {
	select {
	case handler.updates <- value:
		return true
	case <-ctx.Done():
		return false
	}
}
