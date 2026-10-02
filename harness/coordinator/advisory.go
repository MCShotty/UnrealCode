package coordinator

import (
	"context"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

func (current *coordinator) advisoryOutcome(id inbox.ID, state string) {
	if current.dependencies.OnAdvisoryOutcome != nil {
		current.dependencies.OnAdvisoryOutcome(id, state)
	}
}

func (current *coordinator) discardAdvisories(state string) {
	for _, input := range current.advisoryInputs {
		current.advisoryOutcome(input.ID, state)
	}
	current.advisoryInputs = nil
}

func (current *coordinator) deliverAdvisories(ctx context.Context) {
	inputs := current.advisoryInputs
	current.advisoryInputs = nil
	for _, input := range inputs {
		value, err := input.DecodeAdvisory()
		if err != nil || value.Binding.SessionID != string(current.dependencies.SessionID) || value.Binding.SourceInputID != current.state.latestInputID || current.dependencies.AdvisoryValid == nil || !current.dependencies.AdvisoryValid(value.Binding) {
			current.advisoryOutcome(input.ID, "skipped")
			continue
		}
		// A failed advisory write must not reject already accepted user work. Never
		// expose unjournalled advice to the model. The ordinary turn's own durable
		// write still reports a storage failure if the volume is unusable.
		if err := current.dependencies.Sessions.AppendInput(ctx, current.dependencies.SessionID, input); err != nil {
			current.advisoryOutcome(input.ID, "failed")
			continue
		}
		if _, err := current.addItemToLocalState(sessionstore.Item{Kind: sessionstore.ItemInput, Data: input}); err != nil {
			current.advisoryOutcome(input.ID, "failed")
			continue
		}
		current.advisoryOutcome(input.ID, "delivered")
	}
}
