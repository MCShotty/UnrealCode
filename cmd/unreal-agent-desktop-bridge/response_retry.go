package main

import (
	"encoding/json/v2"
	"errors"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"strings"
)

// A deliberate response retry is a new input, never a replay of a tool call or
// of an accepted question answer. Its stable identity survives transport loss.
func (a *app) retryResponse(req request) (any, error) {
	p, err := decodeParams[struct {
		SessionID       string     `json:"sessionId"`
		MessageID       string     `json:"messageId"`
		FailureSequence uint64     `json:"failureSequence"`
		Credential      credential `json:"credential"`
	}](req.Params)
	if err != nil {
		return nil, err
	}
	id, err := requiredID(p.SessionID)
	if err != nil {
		return nil, err
	}
	input, err := externalInput("Retry the failed response using the existing context and accepted answers. Do not repeat completed actions.", p.MessageID)
	if err != nil {
		return nil, err
	}
	restored, err := a.store.Resume(a.ctx, id)
	if err != nil {
		return nil, err
	}
	for _, seen := range restored.ExternalInputIDs {
		if seen == input.ID {
			return map[string]bool{"accepted": true}, nil
		}
	}
	a.mu.Lock()
	run := a.running[id]
	a.mu.Unlock()
	if run != nil {
		run.submitMu.Lock()
		_, accepted := run.accepted[input.ID]
		run.submitMu.Unlock()
		if accepted {
			return map[string]bool{"accepted": true}, nil
		}
		return nil, errors.New("Wait for the previous response and operations to settle before retrying")
	}
	outcome, err := a.events.outcome(id, false)
	if err != nil {
		return nil, err
	}
	if outcome.State != "failed" {
		return nil, errors.New("This conversation no longer has a failed response to retry")
	}
	entries, err := a.events.entries(id, p.FailureSequence-1, 1)
	if err != nil {
		return nil, err
	}
	if p.FailureSequence == 0 || len(entries) != 1 || entries[0].Sequence != p.FailureSequence {
		return nil, errors.New("Refresh the failed response before retrying")
	}
	var payload map[string]any
	_ = json.Unmarshal(entries[0].Payload, &payload)
	providerError := entries[0].Event == "session.status" && payload["status"] == "error" && (strings.Contains(str(payload["message"]), "call model for turn") || strings.Contains(str(payload["message"]), "provider response failed"))
	if !providerError && !(entries[0].Event == "session.item" && prop(payload, "Kind") == "model_response" && prop(prop(prop(payload, "Data"), "Response"), "Failure") != nil) {
		return nil, errors.New("The selected event is not a failed response")
	}
	input.Payload, _ = json.Marshal(map[string]any{"prompt": "Retry the failed response using retained context and already accepted answers. Do not repeat completed actions.", "retryOf": p.FailureSequence})
	input.Kind = inbox.InputExternal
	if _, err = a.start(id, p.Credential, input); err != nil {
		return nil, err
	}
	return map[string]bool{"accepted": true}, nil
}
