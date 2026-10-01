// Command unreal-agent-desktop-bridge keeps Unreal Agent sessions alive and
// accepts versioned JSONL requests from a local desktop process over stdio.
package main

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}
type cancelOperationParams struct {
	SessionID   string `json:"sessionId"`
	OperationID string `json:"operationId"`
}
type createParams struct {
	Config      sessionConfig `json:"config"`
	Credential  credential    `json:"credential"`
	QueueTaskID string        `json:"queueTaskId,omitempty"`
}
type openParams struct {
	SessionID  string     `json:"sessionId"`
	Credential credential `json:"credential"`
}
type sendParams struct {
	NativeContext bool              `json:"nativeContext,omitempty"`
	Fieldnotes    *fieldnoteReceipt `json:"fieldnotes,omitempty"`
	Images        []string          `json:"images,omitempty"`
	SessionID     string            `json:"sessionId"`
	MessageID     string            `json:"messageId"`
	Prompt        string            `json:"prompt"`
	Credential    credential        `json:"credential"`
}
type historyParams struct {
	SessionID string `json:"sessionId"`
	After     uint64 `json:"after"`
	Limit     int    `json:"limit"`
}
type forkParams struct {
	SessionID  string     `json:"sessionId"`
	Credential credential `json:"credential"`
}
type installDecisionParams struct {
	Engine string `json:"engine"`
}
type extractParams struct {
	Text   string   `json:"text"`
	Labels []string `json:"labels"`
}

func requiredID(value string) (session.ID, error) {
	if _, err := uuid.Parse(value); err != nil {
		return "", errors.New("invalid session ID")
	}
	return session.ID(value), nil
}

func (a *app) dispatch(req request) (any, error) {
	if req.Version != protocolVersion {
		return nil, fmt.Errorf("unsupported protocol version %d", req.Version)
	}
	switch req.Method {
	case "context.summaries", "context.compact", "context.summary.select":
		p, err := decodeParams[struct {
			SessionID  string     `json:"sessionId"`
			ID         string     `json:"id"`
			Credential credential `json:"credential"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if req.Method == "context.summaries" {
			return a.readSummaries(id)
		}
		if req.Method == "context.summary.select" {
			return nil, a.activateSummary(id, p.ID)
		}
		return a.createSummary(id, p.Credential)
	case "mcp.configure":
		p, err := decodeParams[struct {
			Tools []catalogEntry `json:"tools"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		return nil, a.mcp.configure(p.Tools)
	case "host.respond", "host.dispatched", "computer.image.response":
		p, err := decodeParams[hostReply](req.Params)
		if err != nil {
			return nil, err
		}
		if req.Method == "host.dispatched" {
			a.host.mu.Lock()
			pending, ok := a.host.pending[p.RequestID]
			a.host.mu.Unlock()
			if !ok || string(pending.session) != p.SessionID || string(pending.operation) != p.OperationID {
				return nil, errors.New("host dispatch does not match a live operation")
			}
			a.events.enqueue(pending.session, "operation.dispatched", map[string]string{"ID": p.OperationID})
			a.events.enqueue(pending.session, "host.resolved", map[string]string{"requestId": p.RequestID})
			return nil, nil
		}
		if err := a.host.resolve(p); err != nil {
			return nil, err
		}
		a.events.enqueue(session.ID(p.SessionID), "host.resolved", map[string]string{"requestId": p.RequestID})
		return nil, nil
	case "permission.list", "permission.respond":
		p, err := decodeParams[struct {
			SessionID string `json:"sessionId"`
			ID        string `json:"id"`
			Digest    string `json:"digest"`
			Allow     bool   `json:"allow"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		if run == nil {
			if req.Method == "permission.list" {
				return []approvalRequest{}, nil
			}
			return nil, errors.New("Session is stopped; approval expired")
		}
		if req.Method == "permission.list" {
			return run.permissions.list(), nil
		}
		return nil, run.permissions.resolve(p.ID, p.Digest, p.Allow)
	case "session.team":
		p, err := decodeParams[struct {
			SessionID string `json:"sessionId"`
			Enabled   bool   `json:"enabled"`
			Managed   bool   `json:"managed"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		release, err := a.contextBoundary(id)
		if err != nil {
			return nil, err
		}
		defer release()
		return nil, a.updateConfig(id, func(config *sessionConfig) error {
			if config.Specialist {
				return errors.New("Specialists cannot change delegation permissions")
			}
			config.TeamEnabled = p.Enabled
			config.TeamManaged = p.Managed || p.Enabled
			return nil
		})
	case "hooks.configure":
		p, err := decodeParams[struct {
			Enabled bool `json:"enabled"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		ids := []session.ID{}
		for id, run := range a.running {
			if run.busy.Load() {
				a.mu.Unlock()
				return nil, errors.New("Settle active work before changing hooks")
			}
			ids = append(ids, id)
		}
		a.mu.Unlock()
		if a.hooksEnabled.Load() != p.Enabled {
			for _, id := range ids {
				params, _ := json.Marshal(sessionIDParams{SessionID: string(id)})
				if _, err := a.dispatch(request{Version: protocolVersion, Method: "session.stop", Params: params}); err != nil {
					return nil, err
				}
			}
		}
		a.hooksEnabled.Store(p.Enabled)
		return nil, nil
	case "session.mode":
		p, err := decodeParams[struct {
			SessionID string `json:"sessionId"`
			Mode      string `json:"mode"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		if !validMode(p.Mode) {
			return nil, errors.New("Invalid execution mode")
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		run := a.running[id]
		busy := run != nil && run.busy.Load()
		a.mu.Unlock()
		if busy {
			return nil, errors.New("Finish or stop active work before changing execution mode")
		}
		stopParams, _ := json.Marshal(sessionIDParams{SessionID: p.SessionID})
		if _, err := a.dispatch(request{Version: protocolVersion, Method: "session.stop", Params: stopParams}); err != nil {
			return nil, err
		}
		return nil, a.updateConfig(id, func(config *sessionConfig) error {
			if config.Specialist {
				return errors.New("Specialist execution mode is inherited and cannot be broadened")
			}
			config.Mode = p.Mode
			return nil
		})
	case "session.goal":
		p, err := decodeParams[struct {
			SessionID string `json:"sessionId"`
			Enabled   bool   `json:"enabled"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		return nil, a.updateConfig(id, func(config *sessionConfig) error {
			if config.Specialist {
				return errors.New("Specialists cannot change the parent goal")
			}
			config.GoalManaged = p.Enabled
			return nil
		})
	case "inference.generate":
		p, err := decodeParams[struct {
			Config     sessionConfig `json:"config"`
			Credential credential    `json:"credential"`
			Request    llm.Request   `json:"request"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		p.Config.MaxAttempts = 1
		client, model, err := a.makeClient(p.Config, p.Credential)
		if err != nil {
			return nil, err
		}
		defer client.Close()
		p.Request.Model.ID = model
		p.Request.Model.ReasoningEffort = llm.ReasoningEffort(p.Config.ThinkingLevel)
		ctx, cancel := context.WithTimeout(a.ctx, 120*time.Second)
		defer cancel()
		response, err := client.Respond(ctx, p.Request, llm.RequestOptions{})
		response, err = llm.NormalizeFailure(response, err)
		llm.RedactFailure(&response, p.Credential.APIKey, p.Credential.AccessToken)
		if err != nil {
			return nil, err
		}
		response.Usage.Raw = nil
		return response, nil
	case "session.modelOptions":
		p, err := decodeParams[struct {
			SessionID     string  `json:"sessionId"`
			ServiceTier   *string `json:"serviceTier"`
			ThinkingLevel *string `json:"thinkingLevel"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		return nil, a.updateConfig(id, func(config *sessionConfig) error {
			if config.Specialist {
				return errors.New("Specialist model options belong to its role profile")
			}
			if p.ServiceTier != nil {
				if *p.ServiceTier != "default" && *p.ServiceTier != "priority" {
					return errors.New("Unsupported speed tier")
				}
				if config.Provider != "openai" && config.Provider != "openai-codex" && config.Provider != "anthropic" {
					return errors.New("Provider does not support speed tiers")
				}
				config.ServiceTier = *p.ServiceTier
			}
			if p.ThinkingLevel != nil {
				if !llm.ReasoningEffort(*p.ThinkingLevel).Valid() {
					return errors.New("Unsupported reasoning effort")
				}
				config.ThinkingLevel = *p.ThinkingLevel
			}
			return nil
		})
	case "session.rename":
		p, err := decodeParams[struct {
			SessionID string `json:"sessionId"`
			Title     string `json:"title"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if len(strings.TrimSpace(p.Title)) == 0 || len(p.Title) > 300 {
			return nil, errors.New("Title must contain 1–300 bytes")
		}
		if _, err := a.loadConfig(id); err != nil {
			return nil, err
		}
		return nil, a.rename(id, strings.TrimSpace(p.Title))
	case "context.configure":
		p, err := decodeParams[struct {
			Excluded []string `json:"excluded"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		if err := a.preferences.configure(p.Excluded); err != nil {
			return nil, err
		}
		return map[string]bool{"configured": true}, nil
	case "verification.run":
		p, err := decodeParams[verificationParams](req.Params)
		if err != nil {
			return nil, err
		}
		return a.verifyCommand(p)
	case "verification.cancel":
		p, err := decodeParams[verificationParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		return nil, a.verification.cancel(id, p.ID)
	case "project.idle":
		a.mu.Lock()
		defer a.mu.Unlock()
		for _, run := range a.running {
			if run.busy.Load() || run.stopping.Load() {
				return false, nil
			}
		}
		return !a.verification.busy(), nil
	case "decision.idle":
		return a.decisionPending.Load() == 0, nil
	case "health":
		return map[string]any{"ready": true, "workspace": "/workspace", "version": protocolVersion, "capabilities": []string{"permissions.v1", "files.v1", "sessions.v1", "mcp.v1", "context.v1", "teams.v1", "verification.v1", "history.latest.v1", "lifecycle.v1", "controls.v1", "inference.v1", "hooks.v1", "goal.usage.v1", "questions.v2", "provider.issue.v1", "plan.progress.v1", "decision.browser.v1", "response.preview.v1", "documents.v1", "browser.shared.v1", "fieldnotes.v1", "computer.v1"}}, nil
	case "decision.configure":
		config, err := decodeParams[decisionConfig](req.Params)
		if err != nil {
			return nil, err
		}
		if err := a.decision.configure(config); err != nil {
			return nil, err
		}
		return a.decision.status(), nil
	case "decision.status":
		return a.decision.status(), nil
	case "decision.install":
		params, err := decodeParams[installDecisionParams](req.Params)
		if err != nil {
			return nil, err
		}
		if err := a.decision.install(a.ctx, params.Engine); err != nil {
			return nil, err
		}
		return a.decision.status(), nil
	case "decision.evaluate":
		batch, err := decodeParams[decisionBatch](req.Params)
		if err != nil {
			return nil, err
		}
		return a.decision.evaluate(a.ctx, batch)
	case "decision.retrieval":
		p, err := decodeParams[struct {
			SessionID string        `json:"sessionId"`
			Batch     decisionBatch `json:"batch"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if _, err = a.loadConfig(id); err != nil {
			return nil, err
		}
		a.decisionPending.Add(1)
		defer a.decisionPending.Add(-1)
		result, err := a.decision.evaluate(a.ctx, p.Batch)
		if err != nil {
			return nil, err
		}
		a.events.enqueue(id, "decision.result", traceDecision(result, p.Batch, uuid.New().String(), "Repository retrieval relevance"))
		return result, nil
	case "decision.browser":
		p, err := decodeParams[struct {
			SessionID string        `json:"sessionId"`
			Batch     decisionBatch `json:"batch"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if _, err = a.loadConfig(id); err != nil {
			return nil, err
		}
		a.decisionPending.Add(1)
		defer a.decisionPending.Add(-1)
		result, err := a.decision.evaluate(a.ctx, p.Batch)
		if err != nil {
			return nil, err
		}
		a.events.enqueue(id, "decision.result", traceDecision(result, p.Batch, uuid.New().String(), "BrowserDo page decision"))
		return result, nil
	case "decision.extract":
		params, err := decodeParams[extractParams](req.Params)
		if err != nil {
			return nil, err
		}
		return a.decision.extract(a.ctx, params.Text, params.Labels)
	case "session.create":
		p, err := decodeParams[createParams](req.Params)
		if err != nil {
			return nil, err
		}
		// Only the dedicated create parameter can establish the queue identity.
		// A copied session config must not inherit another task's identity.
		p.Config.QueueTaskID = ""
		id := session.ID(uuid.New().String())
		if p.QueueTaskID != "" {
			id, err = requiredID(p.QueueTaskID)
			if err != nil {
				return nil, errors.New("invalid queued task identity")
			}
			p.Config.QueueTaskID = p.QueueTaskID
			a.createMu.Lock()
			defer a.createMu.Unlock()
		}
		if p.Config.Mode == "" {
			p.Config.Mode = "ask"
		}
		if !validMode(p.Config.Mode) {
			return nil, errors.New("Invalid execution mode")
		}
		probe, _, err := a.makeClient(p.Config, p.Credential)
		if err != nil {
			return nil, err
		}
		_ = probe.Close()
		if p.QueueTaskID != "" {
			_, inspectErr := a.store.Inspect(a.ctx, id)
			if inspectErr == nil {
				saved, loadErr := a.loadConfig(id)
				if loadErr != nil {
					return nil, fmt.Errorf("queued session exists but its config cannot be read: %w", loadErr)
				}
				if saved.QueueTaskID != p.QueueTaskID || saved.WorkspaceID != p.Config.WorkspaceID || saved.Provider != p.Config.Provider || saved.Model != p.Config.Model {
					return nil, errors.New("queued session identity belongs to a different task configuration")
				}
				if _, err := a.start(id, p.Credential); err != nil {
					return nil, err
				}
				return map[string]string{"sessionId": string(id)}, nil
			}
			if !errors.Is(inspectErr, os.ErrNotExist) {
				return nil, inspectErr
			}
			if saved, loadErr := a.loadConfig(id); loadErr == nil {
				if saved.QueueTaskID != p.QueueTaskID || saved.WorkspaceID != p.Config.WorkspaceID || saved.Provider != p.Config.Provider || saved.Model != p.Config.Model {
					return nil, errors.New("queued session config belongs to a different task configuration")
				}
			} else if !errors.Is(loadErr, os.ErrNotExist) {
				return nil, loadErr
			} else if err := a.saveConfig(id, p.Config); err != nil {
				return nil, err
			}
		}
		if _, err := a.store.Create(a.ctx, id); err != nil {
			return nil, err
		}
		if p.QueueTaskID == "" {
			if err := a.saveConfig(id, p.Config); err != nil {
				return nil, err
			}
		}
		if _, err := a.start(id, p.Credential); err != nil {
			return nil, err
		}
		return map[string]string{"sessionId": string(id)}, nil
	case "session.list":
		infos, err := a.store.ListSessions(a.ctx)
		if err != nil {
			return nil, err
		}
		result := make([]map[string]any, 0, len(infos))
		for _, info := range infos {
			a.mu.Lock()
			_, active := a.running[info.ID]
			state := "idle"
			if run := a.running[info.ID]; run != nil {
				state = "idle"
				if run.busy.Load() {
					state = "running"
				}
				if run.stopping.Load() {
					state = "cancelling"
				}
			}
			a.mu.Unlock()
			outcome, outcomeErr := a.events.outcome(info.ID, active)
			if outcomeErr != nil {
				return nil, outcomeErr
			}
			if state != "running" && state != "cancelling" {
				state = outcome.State
			}
			config, _ := a.loadConfig(info.ID)
			result = append(result, map[string]any{"id": string(info.ID), "lastUpdatedAt": info.LastUpdatedAt, "title": a.title(info.ID), "active": active, "state": state, "outcome": outcome, "parentSessionId": config.ParentSessionID})
		}
		sort.Slice(result, func(i, j int) bool {
			return result[i]["lastUpdatedAt"].(time.Time).After(result[j]["lastUpdatedAt"].(time.Time))
		})
		return result, nil
	case "session.open":
		p, err := decodeParams[openParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if _, err := a.start(id, p.Credential); err != nil {
			return nil, err
		}
		return map[string]bool{"active": true}, nil
	case "session.config":
		p, err := decodeParams[sessionIDParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		return a.loadConfig(id)
	case "question.list", "question.answer", "question.dismiss":
		return a.questionRequest(req)
	case "session.retry":
		return a.retryResponse(req)
	case "fieldnotes.configure":
		p, err := decodeParams[struct {
			Notes      []fieldnoteRef `json:"notes"`
			Generation uint64         `json:"generation"`
		}](req.Params)
		if err != nil {
			return nil, err
		}
		if err = a.guidance.configure(p.Notes, p.Generation); err != nil {
			return nil, err
		}
		return map[string]bool{"configured": true}, nil
	case "session.send":
		p, err := decodeParams[sendParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		input, err := externalInput(p.Prompt, p.MessageID)
		if err != nil {
			return nil, err
		}
		if len(p.Images) > 3 {
			return nil, errors.New("At most three images can be attached")
		}
		total := 0
		for _, image := range p.Images {
			total += len(image)
			if !strings.HasPrefix(image, "data:image/png;base64,") && !strings.HasPrefix(image, "data:image/jpeg;base64,") && !strings.HasPrefix(image, "data:image/webp;base64,") {
				return nil, errors.New("Unsupported image attachment")
			}
		}
		if total > 8*1024*1024 {
			return nil, errors.New("Image attachments exceed 8 MiB")
		}
		if err := validateFieldnoteReceipt(p.Fieldnotes, string(id), string(input.ID)); err != nil {
			return nil, err
		}
		if p.Fieldnotes != nil {
			p.Fieldnotes.State = "accepted"
		}
		if len(p.Images) > 0 || p.Fieldnotes != nil || p.NativeContext {
			input.Payload, _ = json.Marshal(map[string]any{"prompt": p.Prompt, "images": p.Images, "fieldnotes": p.Fieldnotes, "nativeContext": p.NativeContext})
		}
		if err := a.submit(id, input, p.Credential); err != nil {
			return nil, err
		}
		return map[string]string{"messageId": string(input.ID)}, nil
	case "session.stop":
		p, err := decodeParams[sessionIDParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.verification.stopSession(id)
		if err := a.questions.cancel(id, "", true); err != nil {
			return nil, err
		}
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		if run == nil {
			return map[string]bool{"stopping": false}, nil
		}
		run.stopping.Store(true)
		payload, err := json.Marshal(inbox.ControlMessage{Mode: inbox.StopHard, Reason: "Stopped by user"})
		if err != nil {
			return nil, err
		}
		err = run.inbox.Submit(a.ctx, inbox.Input{ID: inbox.ID(uuid.New().String()), Kind: inbox.InputControl, Payload: payload})
		if err != nil {
			return nil, err
		}
		select {
		case <-run.done:
			return map[string]bool{"stopping": true}, nil
		case <-time.After(20 * time.Second):
			return nil, errors.New("session stop timed out")
		case <-a.ctx.Done():
			return nil, a.ctx.Err()
		}
	case "operation.cancel":
		p, err := decodeParams[cancelOperationParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(p.OperationID) == "" {
			return nil, errors.New("operation ID is required")
		}
		if a.verification.cancel(id, p.OperationID) == nil {
			return map[string]bool{"canceling": true}, nil
		}
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		if run == nil {
			return nil, errors.New("session is not active")
		}
		if err := run.manager.CancelUser(operation.ID(p.OperationID)); err != nil {
			return nil, err
		}
		return map[string]bool{"canceling": true}, nil
	case "session.fork":
		p, err := decodeParams[forkParams](req.Params)
		if err != nil {
			return nil, err
		}
		parent, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		turn, err := a.lastCompletedTurn(parent)
		if err != nil {
			return nil, err
		}
		config, err := a.loadConfig(parent)
		if err != nil {
			return nil, err
		}
		if config.Specialist {
			return nil, errors.New("Fork the parent task; specialists cannot create independent continuations")
		}
		config.TeamEnabled = false
		config.TeamManaged = false
		config.QueueTaskID = ""
		probe, _, err := a.makeClient(config, p.Credential)
		if err != nil {
			return nil, err
		}
		_ = probe.Close()
		id := session.ID(uuid.New().String())
		if _, err := a.store.Fork(a.ctx, id, parent, turn); err != nil {
			return nil, err
		}
		if err := a.saveConfig(id, config); err != nil {
			return nil, err
		}
		if _, err := a.start(id, p.Credential); err != nil {
			return nil, err
		}
		return map[string]string{"sessionId": string(id)}, nil
	case "session.events", "session.events.latest":
		p, err := decodeParams[historyParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		a.events.flush()
		if err := a.events.reconcile(a.store, id); err != nil {
			return nil, err
		}
		if req.Method == "session.events.latest" {
			return a.events.latest(id, p.Limit)
		}
		return a.events.entries(id, p.After, p.Limit)
	case "session.items":
		p, err := decodeParams[historyParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		return a.store.Items(a.ctx, id, sessionstore.Sequence(p.After), min(max(p.Limit, 1), 1000))
	default:
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}
}

func (a *app) title(id session.ID) string {
	if config, err := a.loadConfig(id); err == nil && config.Title != "" {
		return config.Title
	}
	page, err := a.store.Items(a.ctx, id, 0, 1000)
	if err != nil {
		return "New session"
	}
	fromFork := false
	for _, item := range page.Items {
		if item.Kind == sessionstore.ItemFork {
			fromFork = true
		}
	}
	for _, item := range page.Items {
		if item.Kind != sessionstore.ItemInput {
			continue
		}
		input, ok := item.Data.(inbox.Input)
		if !ok || input.Kind != inbox.InputExternal {
			continue
		}
		var prompt string
		if json.Unmarshal(input.Payload, &prompt) != nil {
			var value struct {
				Prompt string `json:"prompt"`
			}
			if json.Unmarshal(input.Payload, &value) != nil {
				continue
			}
			prompt = value.Prompt
		}
		prompt = sessionTitlePrompt(prompt)
		if prompt != "" {
			if fromFork {
				return "Fork · " + prompt
			}
			return prompt
		}
	}
	return "New session"
}

// App-owned advisory blocks are context, not the user's conversation title.
func sessionTitlePrompt(prompt string) string {
	for _, marker := range []string{"<unrealcode_context>", "<unrealcode_memory>", "<unrealcode_fieldnotes>"} {
		prompt = strings.SplitN(prompt, marker, 2)[0]
	}
	prompt = strings.Join(strings.Fields(prompt), " ")
	letters := []rune(prompt)
	if len(letters) > 48 {
		return string(letters[:48]) + "…"
	}
	return prompt
}

func (a *app) rename(id session.ID, title string) error {
	return a.updateConfig(id, func(config *sessionConfig) error {
		config.Title = title
		return nil
	})
}

func (a *app) lastCompletedTurn(id session.ID) (session.TurnID, error) {
	var after sessionstore.Sequence
	var latest session.TurnID
	for {
		page, err := a.store.Items(a.ctx, id, after, 256)
		if err != nil {
			return "", err
		}
		for _, item := range page.Items {
			if item.Kind == sessionstore.ItemModelResponse {
				latest = item.Data.(sessionstore.ModelResponse).TurnID
			}
		}
		if !page.More {
			break
		}
		after = page.NextAfter
	}
	if latest == "" {
		return "", errors.New("no completed turn to fork")
	}
	return latest, nil
}

func serveRequests(input *os.File, out *output, cancel context.CancelFunc, dispatch func(request) (any, error)) error {
	var requests sync.WaitGroup
	err := readRequests(input, func(req request) {
		requests.Add(1)
		go func() {
			defer requests.Done()
			result, dispatchErr := dispatch(req)
			response := reply{Version: protocolVersion, ID: req.ID, OK: dispatchErr == nil, Result: result}
			if dispatchErr != nil {
				response.Error = dispatchErr.Error()
				response.Result = nil
			}
			if err := out.write(response); err != nil {
				fmt.Fprintln(os.Stderr, "write reply:", err)
			}
		}()
	})
	// EOF means the owning desktop process has gone away. Release pending
	// approvals and host requests before waiting for their dispatch goroutines.
	cancel()
	requests.Wait()
	return err
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	state := os.Getenv("UNREAL_DESKTOP_STATE")
	if state == "" {
		state = "/state"
	}
	state, err := filepath.Abs(state)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	lease, err := acquireBridgeLease(state)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer lease.Close()
	out := &output{w: os.Stdout}
	a, err := newApp(ctx, state, out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	err = serveRequests(os.Stdin, out, cancel, a.dispatch)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read requests:", err)
	}
	a.runs.Wait()
	a.events.flush()
}
