package main

import (
	"bytes"
	"context"
	"sync"
	"testing"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
)

type cancelTrackingManager struct {
	mu       sync.Mutex
	canceled []operation.ID
}

func (m *cancelTrackingManager) Add(operation.Operation) error { return nil }
func (m *cancelTrackingManager) Cancel(id operation.ID, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.canceled = append(m.canceled, id)
	return nil
}
func (m *cancelTrackingManager) Updates() <-chan operation.Operation {
	return make(chan operation.Operation)
}

func TestOperationCancellationIsScopedToActiveSession(t *testing.T) {
	ctx := context.Background()
	log, err := newEventLog(t.TempDir(), &output{w: &bytes.Buffer{}})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID(uuid.New().String())
	other := session.ID(uuid.New().String())
	inner := &cancelTrackingManager{}
	manager := &observedManager{inner: inner, events: log, id: id, ctx: ctx, known: make(map[operation.ID]operation.Status)}
	if err := manager.Add(operation.Operation{ID: "operation-1", Type: operation.TypeShell, Status: operation.StatusReady}); err != nil {
		t.Fatal(err)
	}
	a := &app{running: map[session.ID]*runningSession{id: {manager: manager}}}
	requestFor := func(sessionID session.ID, operationID string) request {
		return request{Version: protocolVersion, Method: "operation.cancel", Params: mustJSON(t, cancelOperationParams{SessionID: string(sessionID), OperationID: operationID})}
	}
	if _, err := a.dispatch(requestFor(other, "operation-1")); err == nil {
		t.Fatal("other session could cancel this operation")
	}
	if _, err := a.dispatch(requestFor(id, "unknown")); err == nil {
		t.Fatal("unknown operation was accepted")
	}
	if _, err := a.dispatch(requestFor(id, "operation-1")); err != nil {
		t.Fatal(err)
	}
	inner.mu.Lock()
	if len(inner.canceled) != 1 || inner.canceled[0] != "operation-1" {
		t.Fatalf("cancellations: %v", inner.canceled)
	}
	inner.mu.Unlock()
	log.flush()
	entries, err := log.entries(id, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Event != "operation.started" || entries[0].RecordedAt.IsZero() || time.Since(entries[0].RecordedAt) > time.Minute {
		t.Fatalf("invalid timestamped operation event: %+v", entries)
	}
}

func BenchmarkTelemetryEnqueue(b *testing.B) {
	log, err := newEventLog(b.TempDir(), &output{w: &bytes.Buffer{}})
	if err != nil {
		b.Fatal(err)
	}
	id := session.ID(uuid.New().String())
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		log.enqueue(id, "model.request.started", map[string]string{"id": "test"})
	}
	b.StopTimer()
	log.flush()
}

func BenchmarkTelemetrySynchronousAppend(b *testing.B) {
	log, err := newEventLog(b.TempDir(), &output{w: &bytes.Buffer{}})
	if err != nil {
		b.Fatal(err)
	}
	id := session.ID(uuid.New().String())
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := log.append(id, "model.request.started", map[string]string{"id": "test"}, 0); err != nil {
			b.Fatal(err)
		}
	}
}
