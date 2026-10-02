package main

import (
	"context"
	"errors"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/session"
)

type advisorySlot struct {
	binding inbox.AdvisoryBinding
	reply   chan bool
}
type advisorySlotMessage struct {
	ID      inbox.ID              `json:"id"`
	Binding inbox.AdvisoryBinding `json:"binding"`
	Granted bool                  `json:"granted,omitempty"`
}

// The local FIFO bounds each bridge. Production Electron additionally owns two
// leases across all project bridges. A lease is released only after the actual
// analysis settles, including cancellation, not when the UI stops waiting.
func (a *app) acquireAdvisorySlot(ctx context.Context, job *advisoryJob) (func(), error) {
	a.slotMu.Lock()
	if !a.hostAdvisorySlots {
		a.slotMu.Unlock()
		return func() {}, nil
	}
	entry := advisorySlot{binding: job.binding, reply: make(chan bool, 1)}
	if a.slots == nil {
		a.slots = map[inbox.ID]advisorySlot{}
	}
	a.slots[job.id] = entry
	a.slotMu.Unlock()
	release := func() {
		a.slotMu.Lock()
		delete(a.slots, job.id)
		a.slotMu.Unlock()
		a.events.signal(session.ID(job.binding.SessionID), "advisory.slot.release", advisorySlotMessage{ID: job.id, Binding: job.binding})
	}
	a.events.signal(session.ID(job.binding.SessionID), "advisory.slot.requested", advisorySlotMessage{ID: job.id, Binding: job.binding})
	select {
	case granted := <-entry.reply:
		if granted && sValid(a, job) && ctx.Err() == nil {
			return release, nil
		}
		release()
		return nil, errors.New("Background decision capacity or ownership unavailable")
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	}
}
func sValid(a *app, job *advisoryJob) bool {
	return a.advisoryValid(job.run, job.binding, job.postflight != nil)
}
func (a *app) answerAdvisorySlot(p advisorySlotMessage) error {
	a.slotMu.Lock()
	defer a.slotMu.Unlock()
	entry, ok := a.slots[p.ID]
	if !ok || entry.binding != p.Binding {
		return errors.New("Decision lease is not owned by this live analysis")
	}
	select {
	case entry.reply <- p.Granted:
		return nil
	default:
		return errors.New("Decision lease was already acknowledged")
	}
}
