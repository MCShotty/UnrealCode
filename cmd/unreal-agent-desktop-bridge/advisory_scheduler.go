package main

import (
	"context"
	"encoding/json/v2"
	"errors"
	"sync"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/session"
)

const advisoryDeadline = 15 * time.Second

type advisoryJob struct {
	id         inbox.ID
	binding    inbox.AdvisoryBinding
	run        *runningSession
	config     decisionConfig
	prompt     string
	postflight *postflightCandidate
	cancel     context.CancelFunc
	state      string
	issue      *advisoryIssue
}
type advisoryStatus struct {
	Version int                   `json:"version"`
	ID      inbox.ID              `json:"id"`
	Binding inbox.AdvisoryBinding `json:"binding"`
	State   string                `json:"state"`
	Message string                `json:"message,omitempty"`
	Issue   *advisoryIssue        `json:"issue,omitempty"`
}
type advisoryScheduler struct {
	app      *app
	mu       sync.Mutex
	pending  map[session.ID]*advisoryJob
	active   map[session.ID]*advisoryJob
	current  map[session.ID]*advisoryJob
	queue    []session.ID
	wake     chan struct{}
	finished chan *advisoryJob
	workers  sync.WaitGroup
}

func newAdvisoryScheduler(a *app) *advisoryScheduler {
	s := &advisoryScheduler{app: a, pending: map[session.ID]*advisoryJob{}, active: map[session.ID]*advisoryJob{}, current: map[session.ID]*advisoryJob{}, wake: make(chan struct{}, 1), finished: make(chan *advisoryJob, 2)}
	a.runs.Add(1)
	go func() { defer a.runs.Done(); s.loop() }()
	return s
}
func (s *advisoryScheduler) notify() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *advisoryScheduler) statusLocked(job *advisoryJob, state, message string) {
	if job.state == state {
		return
	}
	job.state = state
	s.app.events.enqueue(session.ID(job.binding.SessionID), "decision.advisory", advisoryStatus{Version: 1, ID: job.id, Binding: job.binding, State: state, Message: message, Issue: job.issue})
}
func (s *advisoryScheduler) queueJob(job *advisoryJob) {
	id := session.ID(job.binding.SessionID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.app.ctx.Err() != nil {
		return
	}
	if previous := s.current[id]; previous != nil {
		if previous.cancel != nil {
			previous.cancel()
		}
		if previous.state != "delivered" && previous.state != "failed" && previous.state != "skipped" && previous.state != "cancelled" {
			s.statusLocked(previous, "skipped", "Superseded by newer work")
		}
	}
	if s.pending[id] == nil {
		s.queue = append(s.queue, id)
	}
	s.pending[id] = job
	s.current[id] = job
	s.statusLocked(job, "queued", "")
	s.notify()
}
func (s *advisoryScheduler) invalidate(id session.ID, state string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if job := s.current[id]; job != nil {
		if job.cancel != nil {
			job.cancel()
		}
		if job.state == "queued" || job.state == "analysing" || job.state == "ready" {
			s.statusLocked(job, state, "")
		}
	}
	delete(s.pending, id)
	s.notify()
}
func (s *advisoryScheduler) invalidateAll(state string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, job := range s.current {
		if job.cancel != nil {
			job.cancel()
		}
		if job.state == "queued" || job.state == "analysing" || job.state == "ready" {
			s.statusLocked(job, state, "")
		}
		delete(s.pending, id)
	}
	s.notify()
}
func (s *advisoryScheduler) outcome(id inbox.ID, state string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.current {
		if job.id == id && job.state == "ready" {
			s.statusLocked(job, state, "")
			return
		}
	}
}
func (s *advisoryScheduler) valid(job *advisoryJob) bool {
	return s.app.advisoryValid(job.run, job.binding, job.postflight != nil)
}
func (s *advisoryScheduler) loop() {
	defer func() { s.invalidateAll("interrupted"); s.workers.Wait() }()
	for {
		select {
		case <-s.app.ctx.Done():
			return
		case job := <-s.finished:
			s.mu.Lock()
			job.config.APIKey = ""
			job.prompt = ""
			if s.active[session.ID(job.binding.SessionID)] == job {
				delete(s.active, session.ID(job.binding.SessionID))
			}
			s.mu.Unlock()
		case <-s.wake:
		}
		s.mu.Lock()
		// FIFO across conversations, with only the latest queued snapshot per
		// conversation. Cancelled work still occupies its slot until it settles.
		for checked := len(s.queue); checked > 0 && len(s.active) < 2; checked-- {
			id := s.queue[0]
			s.queue = s.queue[1:]
			job := s.pending[id]
			if job == nil {
				continue
			}
			if s.active[id] != nil {
				s.queue = append(s.queue, id)
				continue
			}
			delete(s.pending, id)
			if !s.valid(job) {
				s.statusLocked(job, "skipped", "Work or configuration changed")
				continue
			}
			ctx, cancel := context.WithTimeout(job.run.ctx, advisoryDeadline)
			job.cancel = cancel
			s.active[id] = job
			s.statusLocked(job, "analysing", "")
			s.workers.Add(1)
			s.app.decisionPending.Add(1)
			go func() {
				defer s.workers.Done()
				defer s.app.decisionPending.Add(-1)
				defer cancel()
				s.execute(ctx, job)
				select {
				case s.finished <- job:
				case <-s.app.ctx.Done():
				}
			}()
		}
		s.mu.Unlock()
	}
}
func (s *advisoryScheduler) execute(ctx context.Context, job *advisoryJob) {
	if err := s.app.ensureAdvisoryBackup(ctx, session.ID(job.binding.SessionID)); err != nil {
		s.mu.Lock()
		if job.state == "analysing" {
			s.statusLocked(job, "failed", "Decision advice skipped because its recovery backup could not be verified; coding continues")
		}
		s.mu.Unlock()
		return
	}
	release, err := s.app.acquireAdvisorySlot(ctx, job)
	if err != nil {
		s.mu.Lock()
		if job.state == "analysing" {
			s.statusLocked(job, "skipped", "Background decision capacity unavailable; coding continues")
		}
		s.mu.Unlock()
		return
	}
	defer release()
	if job.postflight != nil {
		s.app.verifyPostflight(ctx, session.ID(job.binding.SessionID), *job.postflight, job.config, func() bool { return s.valid(job) })
		s.mu.Lock()
		if job.state == "analysing" {
			s.statusLocked(job, "skipped", "Post-change verification recorded without requesting a model turn")
		}
		s.mu.Unlock()
		return
	}
	// Git evidence collection is optional telemetry and never runs on admission.
	s.app.rememberPostflight(ctx, session.ID(job.binding.SessionID), string(job.binding.SourceInputID), job.prompt, job.binding, job.run)
	batch := preflightBatch(job.prompt)
	result, text, err := s.app.preflight(ctx, job.config, batch)
	s.mu.Lock()
	defer s.mu.Unlock()
	if job.state != "analysing" {
		if result.Model != "" && result.Usage != nil {
			s.app.events.enqueue(session.ID(job.binding.SessionID), "decision.usage", map[string]any{"id": job.id, "engine": result.Engine, "model": result.Model, "usage": result.Usage, "used": false})
		}
		return
	}
	if !s.valid(job) {
		if result.Model != "" && result.Usage != nil {
			s.app.events.enqueue(session.ID(job.binding.SessionID), "decision.usage", map[string]any{"id": job.id, "engine": result.Engine, "model": result.Model, "usage": result.Usage, "used": false})
		}
		s.statusLocked(job, "skipped", "Work or configuration changed")
		return
	}
	if err != nil {
		issue := decisionIssue(err)
		job.issue = &issue
		message := "Decision advice unavailable; coding continues."
		if errors.Is(err, context.DeadlineExceeded) {
			message = "Decision advice timed out; coding continues."
		}
		if errors.Is(err, context.Canceled) {
			s.statusLocked(job, "cancelled", "")
			return
		}
		s.statusLocked(job, "failed", message)
		return
	}
	// Record probabilities, resolved model, and measured usage before delivery.
	if err := s.app.events.append(session.ID(job.binding.SessionID), "decision.result", traceDecision(result, batch, string(job.id), "Background request routing and risk signals"), 0); err != nil {
		s.statusLocked(job, "failed", "Decision advice could not be recorded; coding continues.")
		return
	}
	payload, err := json.Marshal(inbox.Advisory{Version: 1, Binding: job.binding, Text: text})
	if err != nil {
		s.statusLocked(job, "failed", "Decision advice could not be encoded")
		return
	}
	s.statusLocked(job, "ready", "")
	if err := job.run.inbox.Submit(ctx, inbox.Input{ID: job.id, Kind: inbox.InputAdvisory, Payload: payload}); err != nil {
		s.statusLocked(job, "cancelled", "")
	}
}

func (a *app) advisoryValid(run *runningSession, binding inbox.AdvisoryBinding, allowIdle bool) bool {
	if run.ctx.Err() != nil || run.stopping.Load() {
		return false
	}
	run.advisoryMu.Lock()
	current, settled := run.advisoryBinding, run.advisorySettled
	run.advisoryMu.Unlock()
	a.decision.mu.RLock()
	generation := a.decision.generation
	a.decision.mu.RUnlock()
	return current == binding && generation == binding.DecisionGeneration && (allowIdle || !settled)
}
func (a *app) scheduleAdvisory(run *runningSession, prompt string, native bool) {
	run.advisoryMu.Lock()
	binding := run.advisoryBinding
	run.advisoryMu.Unlock()
	a.advisories.invalidate(session.ID(binding.SessionID), "skipped")
	if native || !shouldPreflight(prompt) || !a.decision.available() {
		return
	}
	if !decisionEvidenceSafe(prompt) {
		a.events.enqueue(session.ID(binding.SessionID), "decision.advisory", advisoryStatus{Version: 1, ID: inbox.ID(uuid.New().String()), Binding: binding, State: "skipped", Message: "Decision advice withheld credential-bearing text"})
		return
	}
	a.decision.mu.RLock()
	config := a.decision.config
	a.decision.mu.RUnlock()
	a.advisories.queueJob(&advisoryJob{id: inbox.ID(uuid.New().String()), binding: binding, run: run, config: config, prompt: boundedUTF8(prompt, 12000)})
}

func (a *app) invalidateAdvisoryContext(id session.ID) {
	a.mu.Lock()
	for sessionID, run := range a.running {
		if id != "" && id != sessionID {
			continue
		}
		run.advisoryMu.Lock()
		run.advisoryBinding.ContextRevision++
		run.advisoryMu.Unlock()
	}
	a.mu.Unlock()
	if id == "" {
		a.advisories.invalidateAll("cancelled")
	} else {
		a.advisories.invalidate(id, "cancelled")
	}
}
