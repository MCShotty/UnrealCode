package main

import (
	"context"
	"sync"

	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

// The local file store's observer registration and per-session writes are not
// globally serialized. A desktop bridge can run several coordinators at once.
type lockedStore struct {
	mu sync.Mutex
	sessionstore.Store
}

func (s *lockedStore) AddObserver(observer sessionstore.Observer) sessionstore.ObserverID {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.AddObserver(observer)
}
func (s *lockedStore) RemoveObserver(id sessionstore.ObserverID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Store.RemoveObserver(id)
}
func (s *lockedStore) Create(ctx context.Context, id session.ID) (sessionstore.Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.Create(ctx, id)
}
func (s *lockedStore) ListSessions(ctx context.Context) ([]sessionstore.SessionInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.ListSessions(ctx)
}
func (s *lockedStore) Inspect(ctx context.Context, id session.ID) (sessionstore.Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.Inspect(ctx, id)
}
func (s *lockedStore) Items(ctx context.Context, id session.ID, after sessionstore.Sequence, limit int) (sessionstore.Page, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.Items(ctx, id, after, limit)
}
func (s *lockedStore) AppendInput(ctx context.Context, id session.ID, value inbox.Input) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.AppendInput(ctx, id, value)
}
func (s *lockedStore) AppendTurn(ctx context.Context, id session.ID, value session.Turn) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.AppendTurn(ctx, id, value)
}
func (s *lockedStore) AppendModelResponse(ctx context.Context, id session.ID, value sessionstore.ModelResponse) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.AppendModelResponse(ctx, id, value)
}
func (s *lockedStore) AppendToolCallStatus(ctx context.Context, id session.ID, value sessionstore.ToolCallStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.AppendToolCallStatus(ctx, id, value)
}
func (s *lockedStore) SaveOperation(ctx context.Context, id session.ID, value operation.Operation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.SaveOperation(ctx, id, value)
}
func (s *lockedStore) Resume(ctx context.Context, id session.ID) (sessionstore.ResumeState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.Resume(ctx, id)
}
func (s *lockedStore) Fork(ctx context.Context, id, parent session.ID, turn session.TurnID) (sessionstore.Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Store.Fork(ctx, id, parent, turn)
}
