package main

import (
	"context"
	"crypto/sha256"
	"encoding/json/v2"
	"errors"
	"fmt"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"sync"
	"time"
	"uuid"
)

func (a *app) runHooks(ctx context.Context, id session.ID, workspace, eventName, toolName string, operationID operation.ID) error {
	if !a.hooksEnabled.Load() {
		return nil
	}
	originalID := operationID
	digest := sha256.Sum256([]byte(string(operationID) + ":" + eventName))
	digest[6] = (digest[6] & 15) | 64
	digest[8] = (digest[8] & 63) | 128
	operationID = operation.ID(fmt.Sprintf("%x-%x-%x-%x-%x", digest[:4], digest[4:6], digest[6:8], digest[8:10], digest[10:16]))
	requestID := uuid.New().String()
	reply := make(chan hostReply, 1)
	a.host.mu.Lock()
	if a.host.pending == nil {
		a.host.pending = map[string]hostPending{}
	}
	a.host.pending[requestID] = hostPending{session: id, operation: operationID, reply: reply}
	a.host.mu.Unlock()
	defer func() { a.host.mu.Lock(); delete(a.host.pending, requestID); a.host.mu.Unlock() }()
	a.events.enqueue(id, "host.hook", map[string]any{"requestId": requestID, "sessionId": id, "workspaceId": workspace, "operationId": operationID, "tool": toolName, "arguments": map[string]any{"event": eventName, "targetOperationId": originalID}})
	timer := time.NewTimer(150 * time.Second)
	defer timer.Stop()
	select {
	case response := <-reply:
		if response.Error {
			return errors.New(response.Text)
		}
		return nil
	case <-ctx.Done():
		a.events.enqueue(id, "host.cancel", map[string]any{"operationId": operationID})
		return ctx.Err()
	case <-timer.C:
		a.events.enqueue(id, "host.cancel", map[string]any{"operationId": operationID})
		return errors.New("Hook approval or execution timed out")
	}
}

type hookOperation struct {
	cancel  context.CancelFunc
	ctx     context.Context
	started bool
	value   operation.Operation
}
type hookManager struct {
	inner           operation.Manager
	app             *app
	ctx             context.Context
	id              session.ID
	workspace, mode string
	mu              sync.Mutex
	pending         map[operation.ID]*hookOperation
	updates         chan operation.Operation
	work            sync.WaitGroup
	closed          bool
}

func newHookManager(ctx context.Context, inner operation.Manager, a *app, id session.ID, workspace, mode string) operation.Manager {
	if !a.hooksEnabled.Load() || mode == "plan" {
		return inner
	}
	m := &hookManager{inner: inner, app: a, ctx: ctx, id: id, workspace: workspace, mode: mode, pending: map[operation.ID]*hookOperation{}, updates: make(chan operation.Operation, 32)}
	go m.forward()
	return m
}
func hookTool(value operation.Operation) string {
	toolName, _, _ := operationPermission(value)
	if value.Type == operation.TypeRemoteJob {
		if state, err := operation.DecodeRemoteJobState(value); err == nil {
			var input mcpInput
			if json.Unmarshal(state.Plan.Data, &input) == nil && input.Tool != "" {
				return input.Tool
			}
		}
	}
	return toolName
}
func (m *hookManager) Add(value operation.Operation) error {
	if m.ctx.Err() != nil {
		return m.ctx.Err()
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return errors.New("Hook manager stopped")
	}
	if m.pending[value.ID] != nil {
		m.mu.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(m.ctx)
	entry := &hookOperation{cancel: cancel, ctx: ctx, value: value}
	m.pending[value.ID] = entry
	m.work.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.work.Done()
		err := m.app.runHooks(ctx, m.id, m.workspace, "beforeTool", hookTool(value), value.ID)
		if err != nil {
			rejected := terminatedOperation(value, err.Error())
			if ctx.Err() == nil {
				rejected.Status = operation.StatusFailed
			}
			m.finish(rejected)
			return
		}
		m.mu.Lock()
		if ctx.Err() != nil {
			m.mu.Unlock()
			m.finish(terminatedOperation(value, "Hook operation cancelled"))
			return
		}
		entry.started = true
		err = m.inner.Add(value)
		m.mu.Unlock()
		if err != nil {
			m.finish(terminatedOperation(value, err.Error()))
		}
	}()
	return nil
}
func (m *hookManager) Cancel(id operation.ID, reason string) error {
	m.mu.Lock()
	entry := m.pending[id]
	if entry != nil {
		entry.cancel()
	}
	started := entry != nil && entry.started
	m.mu.Unlock()
	if started {
		return m.inner.Cancel(id, reason)
	}
	return nil
}
func (m *hookManager) Updates() <-chan operation.Operation { return m.updates }
func (m *hookManager) finish(value operation.Operation) {
	m.mu.Lock()
	entry := m.pending[value.ID]
	if entry != nil {
		entry.cancel()
		delete(m.pending, value.ID)
	}
	m.mu.Unlock()
	if entry == nil {
		return
	}
	select {
	case m.updates <- value:
	case <-m.ctx.Done():
	}
}
func (m *hookManager) forward() {
	for value := range m.inner.Updates() {
		if value.Status != operation.StatusCompleted && value.Status != operation.StatusFailed && value.Status != operation.StatusCanceled {
			select {
			case m.updates <- value:
			case <-m.ctx.Done():
			}
			continue
		}
		m.mu.Lock()
		entry := m.pending[value.ID]
		m.mu.Unlock()
		if entry == nil {
			continue
		}
		m.work.Add(1)
		go func(value operation.Operation, entry *hookOperation) {
			defer m.work.Done()
			if entry.ctx.Err() == nil {
				if err := m.app.runHooks(entry.ctx, m.id, m.workspace, "afterTool", hookTool(value), value.ID); err != nil {
					m.app.events.enqueue(m.id, "hook.failed", map[string]any{"operationId": value.ID, "message": err.Error()})
				}
			}
			m.finish(value)
		}(value, entry)
	}
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
	m.work.Wait()
	close(m.updates)
}
