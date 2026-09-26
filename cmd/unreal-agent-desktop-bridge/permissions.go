package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"sync"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

type modeTranslator struct {
	inner tool.Translator
	mode  string
}

func (t modeTranslator) Translate(ctx tool.Context, call llm.ToolCall) tool.CallStatus {
	if t.mode == "plan" {
		return tool.CallStatus{Error: "Plan mode permits reading and search only"}
	}
	return t.inner.Translate(ctx, call)
}
func (t modeTranslator) TranslateResult(id string, status tool.CallStatus, values []operation.Operation) (llm.ToolResult, error) {
	return t.inner.TranslateResult(id, status, values)
}

type approvalRequest struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"sessionId"`
	WorkspaceID string    `json:"workspaceId"`
	OperationID string    `json:"operationId"`
	Digest      string    `json:"digest"`
	Tool        string    `json:"tool"`
	Arguments   any       `json:"arguments"`
	ExpiresAt   time.Time `json:"expiresAt"`
}
type pendingApproval struct {
	request   approvalRequest
	operation operation.Operation
	timer     *time.Timer
}

// permissionManager gates dispatch, never the coordinator. Queued approvals are
// live capabilities, not durable grants: replay always allocates a fresh nonce.
type permissionManager struct {
	ctx             context.Context
	inner           operation.Manager
	mode, workspace string
	session         session.ID
	events          *eventLog
	mu              sync.Mutex
	pending         map[string]*pendingApproval
	accepted        map[operation.ID]bool
	queue           []operation.Operation
	wake            chan struct{}
	updates         chan operation.Operation
}

func newPermissionManager(ctx context.Context, inner operation.Manager, mode, workspace string, id session.ID, events *eventLog) *permissionManager {
	m := &permissionManager{ctx: ctx, inner: inner, mode: mode, workspace: workspace, session: id, events: events, pending: map[string]*pendingApproval{}, accepted: map[operation.ID]bool{}, wake: make(chan struct{}, 1), updates: make(chan operation.Operation)}
	go m.forward()
	return m
}
func validMode(mode string) bool { return mode == "ask" || mode == "plan" || mode == "agent" }
func operationPermission(value operation.Operation) (tool string, args any, readOnly bool) {
	switch value.Type {
	case operation.TypeShell:
		state, err := operation.DecodeShellState(value)
		if err == nil {
			return "Bash", state.Input, false
		}
	case operation.TypeViewImage:
		return "ViewImage", nil, true
	case operation.TypeSkillUse:
		return "SkillUse", nil, true
	case operation.TypeRemoteJob:
		state, err := operation.DecodeRemoteJobState(value)
		if err != nil {
			break
		}
		switch state.Plan.Type {
		case filePlan:
			var input fileArgs
			if json.Unmarshal(state.Plan.Data, &input) == nil {
				return map[string]string{"read": "ReadFile", "list": "ListFiles", "patch": "ApplyPatch"}[input.Action], input, input.Action == "read" || input.Action == "list"
			}
		case workflowPlan, decisionPlanType, entityPlanType, catalogPlan, repositoryPlan:
			return string(state.Plan.Type), state.Plan.Data, true
		case mcpPlan:
			return "MCP", state.Plan.Data, false
		}
	}
	return string(value.Type), value.State, false
}
func (m *permissionManager) emit(kind string, payload any) {
	if m.events != nil {
		m.events.enqueue(m.session, kind, payload)
	}
}
func (m *permissionManager) queueLocked(value operation.Operation) {
	m.queue = append(m.queue, value)
	select {
	case m.wake <- struct{}{}:
	default:
	}
}
func (m *permissionManager) Add(value operation.Operation) error {
	// Awaiting approval is represented as an awaiting operation for replay, but
	// no shell phase has begun. Restore that inert shell to Ready before it is
	// eventually dispatched; an already-started shell retains its recovery phase.
	if value.Type == operation.TypeShell && value.Status == operation.StatusAwaiting {
		if state, err := operation.DecodeShellState(value); err == nil && state.Phase == "" && state.ProcessGroupID == 0 && state.Result == nil && state.TerminalError == "" {
			value.Status = operation.StatusReady
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ctx.Err() != nil {
		return m.ctx.Err()
	}
	if m.accepted[value.ID] {
		return nil
	}
	tool, args, readOnly := operationPermission(value)
	if !readOnly && m.mode == "plan" {
		m.accepted[value.ID] = true
		m.queueLocked(terminatedOperation(value, "Plan mode only permits dedicated reading and search tools"))
		return nil
	}
	// MCP actions are approved by the main-process broker. Plan was rejected
	// above; Ask must not create a second, independent approval in the container.
	if readOnly || tool == "MCP" || m.mode == "agent" || m.mode == "" {
		if tool != "MCP" {
			m.emit("operation.dispatched", value)
		}
		if err := m.inner.Add(value); err != nil {
			return err
		}
		m.accepted[value.ID] = true
		return nil
	}
	encoded, err := json.Marshal(struct {
		Session, Workspace string
		Operation          operation.Operation
	}{string(m.session), m.workspace, value})
	if err != nil {
		return err
	}
	hash := sha256.Sum256(encoded)
	req := approvalRequest{ID: uuid.New().String(), SessionID: string(m.session), WorkspaceID: m.workspace, OperationID: string(value.ID), Digest: hex.EncodeToString(hash[:]), Tool: tool, Arguments: args, ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}
	entry := &pendingApproval{request: req, operation: value}
	m.pending[req.ID] = entry
	m.accepted[value.ID] = true
	entry.timer = time.AfterFunc(time.Until(req.ExpiresAt), func() { _ = m.resolve(req.ID, req.Digest, false) })
	awaiting := value
	awaiting.Status = operation.StatusAwaiting
	m.queueLocked(awaiting)
	m.emit("permission.requested", req)
	return nil
}
func (m *permissionManager) list() []approvalRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := []approvalRequest{}
	for _, value := range m.pending {
		result = append(result, value.request)
	}
	return result
}
func terminatedOperation(value operation.Operation, reason string) operation.Operation {
	if value.Type == operation.TypeRemoteJob {
		if state, err := operation.DecodeRemoteJobState(value); err == nil {
			state.TerminalError = reason
			state.TerminalResult = ""
			if step, err := operation.UpdateRemoteJob(value, state, operation.StatusCanceled); err == nil {
				return *step.Operation
			}
		}
	}
	if value.Type == operation.TypeShell {
		if state, err := operation.DecodeShellState(value); err == nil {
			state.TerminalError = reason
			value.State, _ = json.Marshal(state)
		}
	}
	value.Status = operation.StatusCanceled
	return value
}
func (m *permissionManager) resolve(id, digest string, allow bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.pending[id]
	if !ok || entry.request.Digest != digest || m.ctx.Err() != nil {
		return errors.New("Approval is stale or does not match this operation")
	}
	if time.Now().After(entry.request.ExpiresAt) {
		allow = false
	}
	delete(m.pending, id)
	entry.timer.Stop()
	state := "denied"
	if allow {
		state = "approved"
		m.emit("operation.dispatched", entry.operation)
		if err := m.inner.Add(entry.operation); err != nil {
			m.queueLocked(terminatedOperation(entry.operation, err.Error()))
			state = "failed"
		}
	} else {
		m.queueLocked(terminatedOperation(entry.operation, "Operation was not approved"))
	}
	m.emit("permission.resolved", map[string]any{"id": id, "operationId": entry.request.OperationID, "state": state})
	return nil
}
func (m *permissionManager) Cancel(id operation.ID, reason string) error {
	m.mu.Lock()
	for key, entry := range m.pending {
		if entry.operation.ID == id {
			delete(m.pending, key)
			entry.timer.Stop()
			m.queueLocked(terminatedOperation(entry.operation, reason))
			m.emit("permission.resolved", map[string]string{"id": key, "state": "cancelled"})
			m.mu.Unlock()
			return nil
		}
	}
	err := m.inner.Cancel(id, reason)
	m.mu.Unlock()
	return err
}
func (m *permissionManager) Updates() <-chan operation.Operation { return m.updates }
func (m *permissionManager) forward() {
	defer close(m.updates)
	defer func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		for _, entry := range m.pending {
			entry.timer.Stop()
		}
		m.pending = map[string]*pendingApproval{}
	}()
	for {
		m.mu.Lock()
		var out chan operation.Operation
		var value operation.Operation
		if len(m.queue) > 0 {
			out = m.updates
			value = m.queue[0]
		}
		m.mu.Unlock()
		select {
		case <-m.ctx.Done():
			return
		case update, ok := <-m.inner.Updates():
			if !ok {
				return
			}
			m.mu.Lock()
			m.queueLocked(update)
			m.mu.Unlock()
		case <-m.wake:
		case out <- value:
			m.mu.Lock()
			m.queue[0] = operation.Operation{}
			m.queue = m.queue[1:]
			m.mu.Unlock()
		}
	}
}
