package main

import (
	"context"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore"
)

type postflightCandidate struct {
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

func (a *app) rememberPostflight(id session.ID, messageID, prompt string) {
	if !shouldPreflight(prompt) || !a.decision.available() {
		return
	}
	before, ok := gitEvidence(a.ctx, a.workspace)
	if !ok {
		return
	}
	a.postMu.Lock()
	if previous := a.postflight[id]; previous.messageID != messageID {
		a.postflight[id] = postflightCandidate{messageID: messageID, prompt: prompt, before: before}
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

func (a *app) maybePostflight(id session.ID, item sessionstore.Item) {
	if item.Kind != sessionstore.ItemModelResponse {
		return
	}
	response, ok := item.Data.(sessionstore.ModelResponse)
	if !ok {
		return
	}
	final := false
	for _, output := range response.Response.Output {
		if message, ok := output.Data.(llm.Message); ok && message.Phase == "final_answer" {
			final = true
			break
		}
	}
	if !final {
		return
	}
	a.postMu.Lock()
	candidate, found := a.postflight[id]
	delete(a.postflight, id)
	a.postMu.Unlock()
	if !found {
		return
	}
	a.runs.Add(1)
	go func() { defer a.runs.Done(); a.verifyPostflight(id, candidate) }()
}

func (a *app) verifyPostflight(id session.ID, candidate postflightCandidate) {
	after, ok := gitEvidence(a.ctx, a.workspace)
	if !ok || candidate.before == after {
		return
	}
	delta := changedEvidence(candidate.before, after)
	if delta == "" {
		return
	}
	if strings.Contains(delta, "-----BEGIN ") && strings.Contains(delta, "PRIVATE KEY-----") {
		_ = a.events.append(id, "decision.error", map[string]string{"message": "Post-change decision withheld text containing a private key."}, 0)
		return
	}
	state := map[string]string{
		"request":      credentialPattern.ReplaceAllString(candidate.prompt, "[credential redacted]"),
		"change_delta": credentialPattern.ReplaceAllString(delta, "[credential redacted]"),
	}
	batch := decisionBatch{State: state, SourceRefs: []string{"user-message", "git-change-delta"}, Questions: map[string]decisionQuestion{
		"requirement_alignment": {Type: "noul", Instructions: "Does change_delta provide concrete evidence that code or files changed toward request? Answer uncertain when only a filename is visible."},
		"contradiction_signal":  {Type: "noul", Instructions: "Does change_delta visibly contradict a specific requirement in request? Judge only shown evidence; do not assume hidden files are correct."},
	}}
	result, err := a.decision.evaluate(a.ctx, batch)
	if err != nil {
		_ = a.events.append(id, "decision.error", map[string]string{"message": err.Error()}, 0)
		return
	}
	_ = a.events.append(id, "decision.result", result, 0)
}
