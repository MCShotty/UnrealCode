// Package coordinator defines the owner of the central event loop.
package coordinator

import (
	"context"
	"errors"
	"time"

	"github.com/unreallabsai/unreal-agent/harness/contextbuilder"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

type Dependencies struct {
	// OnIdle observes completed external-input work after all model and tool work
	// has drained. It must return immediately; observers may enqueue telemetry.
	OnIdle     func([]inbox.ID)
	OnActivity func(bool)
	OnFatal    func(error)
	// InitialInputs are accepted by the host before starting a resumed loop.
	InitialInputs              []inbox.Input
	IncludeQueuedInputsOnStart bool
	// ModelBlocked pauses model requests while independent operations progress.
	ModelBlocked          func() bool
	ModelReady            <-chan struct{}
	ToolHeartbeatInterval time.Duration
	SessionID             session.ID
	Inbox                 *inbox.Inbox
	Restored              sessionstore.ResumeState
	Sessions              sessionstore.Store
	ContextBuilder        contextbuilder.Builder
	LLM                   llm.Adapter
	Tools                 tool.Registry
	Operations            operation.Manager
}

type Coordinator interface {
	// Run owns one session's decision loop until a stop control completes or
	// the context is canceled. It returns nil for a completed stop. It is
	// single-use; its caller must cancel the Inbox when Run returns.
	Run(context.Context) error
}

func New(dependencies Dependencies) Coordinator {
	return &coordinator{
		dependencies: dependencies,
		state:        newLoopState(),
	}
}

// RebuildContext replays persisted items through the same context translation
// used by Run, without starting tools, a model request, or an inbox. The caller
// must hold its session idle/stopped boundary while reading the history.
func RebuildContext(ctx context.Context, id session.ID, store sessionstore.Store, builder contextbuilder.Builder, registry tool.Registry) error {
	current := &coordinator{dependencies: Dependencies{SessionID: id, Sessions: store, ContextBuilder: builder, Tools: registry}, state: newLoopState()}
	if err := current.loadHistory(ctx); err != nil {
		return err
	}
	if len(current.state.toolCalls) > 0 || current.state.availableInputs > current.state.deliveredInputs {
		return errors.New("history has unfinished work; resume or settle it before compaction")
	}
	return nil
}
