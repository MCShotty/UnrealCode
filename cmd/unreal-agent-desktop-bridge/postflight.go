package main

import (
	"context"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"os/exec"
	"sort"
	"strings"
	"time"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/session"
)

type postflightCandidate struct {
	binding   inbox.AdvisoryBinding
	messageID string
	prompt    string
	before    string
}

func gitEvidence(ctx context.Context, workspace string) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	status, err := exec.CommandContext(ctx, "git", "-c", "safe.directory="+workspace, "-C", workspace, "status", "--porcelain", "--untracked-files=normal").Output()
	if err != nil {
		return "", false
	}
	diff, err := exec.CommandContext(ctx, "git", "-c", "safe.directory="+workspace, "-C", workspace, "diff", "--no-ext-diff", "--", ".").Output()
	if err != nil {
		return "", false
	}
	staged, err := exec.CommandContext(ctx, "git", "-c", "safe.directory="+workspace, "-C", workspace, "diff", "--cached", "--no-ext-diff", "--", ".").Output()
	if err != nil {
		return "", false
	}
	evidence := "Git status:\n" + string(status) + "\nUnstaged diff:\n" + string(diff) + "\nStaged diff:\n" + string(staged)
	if len(evidence) > 16000 {
		evidence = evidence[:16000] + "\n[truncated]"
	}
	return evidence, true
}

func changedEvidence(before, after string) string {
	prior := make(map[string]int)
	for _, line := range strings.Split(before, "\n") {
		prior[line]++
	}
	var changes []string
	for _, line := range strings.Split(after, "\n") {
		if prior[line] > 0 {
			prior[line]--
			continue
		}
		if strings.TrimSpace(line) != "" {
			changes = append(changes, "added: "+line)
		}
	}
	var removed []string
	for line, count := range prior {
		if count > 0 && strings.TrimSpace(line) != "" {
			removed = append(removed, "removed: "+line)
		}
	}
	sort.Strings(removed)
	changes = append(changes, removed...)
	if len(changes) == 0 {
		return ""
	}
	result := strings.Join(changes, "\n")
	if len(result) > 12000 {
		result = result[:12000] + "\n[truncated]"
	}
	return result
}

func (a *app) rememberPostflight(ctx context.Context, id session.ID, messageID, prompt string, binding inbox.AdvisoryBinding, run *runningSession) {
	if !shouldPreflight(prompt) || !a.decision.available() {
		return
	}
	before, ok := gitEvidence(ctx, a.workspace)
	if !ok {
		return
	}
	a.postMu.Lock()
	if ctx.Err() == nil && a.advisoryValid(run, binding, false) {
		a.postflight[id] = postflightCandidate{binding: binding, messageID: messageID, prompt: prompt, before: before}
	}
	a.postMu.Unlock()
}

func (a *app) forgetPostflight(id session.ID, messageID string) {
	a.postMu.Lock()
	if a.postflight[id].messageID == messageID {
		delete(a.postflight, id)
	}
	a.postMu.Unlock()
}

func (a *app) finishPostflight(id session.ID) {
	a.postMu.Lock()
	candidate, found := a.postflight[id]
	delete(a.postflight, id)
	a.postMu.Unlock()
	if !found {
		return
	}
	a.mu.Lock()
	run := a.running[id]
	a.mu.Unlock()
	if run == nil || run.stopping.Load() {
		return
	}
	run.advisoryMu.Lock()
	binding := run.advisoryBinding
	run.advisoryMu.Unlock()
	if candidate.binding.RunID != "" && candidate.binding != binding {
		return
	}
	a.decision.mu.RLock()
	config := a.decision.config
	a.decision.mu.RUnlock()
	a.advisories.queueJob(&advisoryJob{id: inbox.ID(uuid.New().String()), binding: binding, run: run, config: config, postflight: &candidate})
}

func (a *app) verifyPostflight(ctx context.Context, id session.ID, candidate postflightCandidate, config decisionConfig, valid func() bool) {
	after, ok := gitEvidence(ctx, a.workspace)
	if !ok || candidate.before == after {
		return
	}
	delta := changedEvidence(candidate.before, after)
	if delta == "" {
		return
	}
	if !decisionEvidenceSafe(candidate.prompt) || !decisionEvidenceSafe(delta) {
		_ = a.events.append(id, "decision.error", map[string]string{"message": "Post-change decision withheld credential-bearing text."}, 0)
		return
	}
	state := map[string]string{
		"request":      candidate.prompt,
		"change_delta": delta,
	}
	batch := decisionBatch{State: state, SourceRefs: []string{"user-message", "git-change-delta"}, Questions: map[string]decisionQuestion{
		"requirement_alignment": {Type: "noul", Instructions: "Does change_delta provide concrete evidence that code or files changed toward request? Answer uncertain when only a filename is visible."},
		"contradiction_signal":  {Type: "noul", Instructions: "Does change_delta visibly contradict a specific requirement in request? Judge only shown evidence; do not assume hidden files are correct."},
	}}
	if !valid() || ctx.Err() != nil {
		return
	}
	result, err := a.decision.evaluateConfigured(ctx, batch, config)
	if err != nil {
		if valid() {
			_ = a.events.append(id, "decision.error", map[string]string{"message": "Post-change decision unavailable; coding continues."}, 0)
		}
		return
	}
	if !valid() || ctx.Err() != nil {
		return
	}
	_ = a.events.append(id, "decision.result", traceDecision(result, batch, candidate.messageID, "Post-change semantic verification"), 0)
}
