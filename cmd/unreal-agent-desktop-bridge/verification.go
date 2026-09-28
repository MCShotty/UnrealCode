package main

import (
	"context"
	"errors"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"
	"uuid"
)

type verificationParams struct {
	SessionID string `json:"sessionId"`
	ID        string `json:"id"`
	Command   string `json:"command"`
	TimeoutMS int    `json:"timeoutMs"`
}
type verificationResult struct {
	ID         string `json:"id"`
	Command    string `json:"command"`
	ExitCode   int    `json:"exitCode"`
	Output     string `json:"output"`
	DurationMS int64  `json:"durationMs"`
	Cancelled  bool   `json:"cancelled"`
}
type verificationRun struct {
	session session.ID
	cancel  context.CancelFunc
}
type verificationRuns struct {
	mu     sync.Mutex
	active map[string]verificationRun
}

func (v *verificationRuns) busy() bool { v.mu.Lock(); defer v.mu.Unlock(); return len(v.active) > 0 }
func (v *verificationRuns) cancel(sessionID session.ID, id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	run, ok := v.active[id]
	if !ok || run.session != sessionID {
		return errors.New("Verification is not active in this session")
	}
	run.cancel()
	return nil
}
func (v *verificationRuns) stopSession(id session.ID) {
	v.mu.Lock()
	defer v.mu.Unlock()
	for _, run := range v.active {
		if run.session == id {
			run.cancel()
		}
	}
}

type verificationOutput struct {
	mu        sync.Mutex
	data      []byte
	truncated bool
}

func (b *verificationOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	remaining := 128*1024 - len(b.data)
	if len(p) > remaining {
		p = p[:remaining]
		b.truncated = true
	}
	b.data = append(b.data, p...)
	return n, nil
}
func (b *verificationOutput) text() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	text := strings.ToValidUTF8(string(b.data), "�")
	if b.truncated {
		text += "\n[Output truncated at 128 KiB]"
	}
	return text
}

// This entry point is invoked only after an explicit main-process profile
// approval. It has no model-facing tool schema and never changes session grants.
func (a *app) verifyCommand(p verificationParams) (verificationResult, error) {
	id, err := requiredID(p.SessionID)
	if err != nil {
		return verificationResult{}, err
	}
	if _, err = uuid.Parse(p.ID); err != nil || len(p.Command) == 0 || len(p.Command) > 16000 || p.TimeoutMS < 1000 || p.TimeoutMS > 600000 {
		return verificationResult{}, errors.New("Invalid bounded verification command")
	}
	config, err := a.loadConfig(id)
	if err != nil {
		return verificationResult{}, err
	}
	if config.Mode == "plan" || slices.Contains(config.DisallowedTools, "Bash") {
		return verificationResult{}, errors.New("This session does not grant command execution")
	}
	ctx, cancel := context.WithTimeout(a.ctx, time.Duration(p.TimeoutMS)*time.Millisecond)
	defer cancel()
	a.verification.mu.Lock()
	if a.verification.active == nil {
		a.verification.active = map[string]verificationRun{}
	}
	if _, ok := a.verification.active[p.ID]; ok {
		a.verification.mu.Unlock()
		return verificationResult{}, errors.New("Verification is already active")
	}
	a.verification.active[p.ID] = verificationRun{session: id, cancel: cancel}
	a.verification.mu.Unlock()
	defer func() { a.verification.mu.Lock(); delete(a.verification.active, p.ID); a.verification.mu.Unlock() }()
	// Persist the start before executing. A repeated completed ID is rejected even
	// after restart, rather than silently re-running arbitrary commands.
	if err = a.recordVerificationStart(id, p.ID); err != nil {
		return verificationResult{}, err
	}
	start := time.Now()
	a.events.enqueue(id, "operation.started", map[string]any{"ID": p.ID, "Type": "verification", "Status": "running", "Command": p.Command})
	command := exec.CommandContext(ctx, "/bin/bash", "-lc", p.Command)
	command.Dir = a.workspace
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.WaitDelay = time.Second
	command.Cancel = func() error {
		if command.Process == nil {
			return nil
		}
		err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return err
	}
	output := &verificationOutput{}
	command.Stdout = output
	command.Stderr = output
	result := verificationResult{ID: p.ID, Command: p.Command}
	err = command.Run()
	if err != nil {
		result.ExitCode = -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			result.ExitCode = exit.ExitCode()
		}
	}
	result.Output = output.text()
	if ctx.Err() == nil {
		if hookErr := a.runHooks(ctx, id, config.WorkspaceID, "verification", "Bash", operation.ID(p.ID)); hookErr != nil {
			result.ExitCode = -1
			err = hookErr
			result.Output += "\nVerification hook failed: " + hookErr.Error()
		}
	}
	result.DurationMS = time.Since(start).Milliseconds()
	result.Cancelled = ctx.Err() != nil
	status := "completed"
	if result.Cancelled {
		status = "canceled"
	} else if err != nil {
		status = "failed"
	}
	a.events.enqueue(id, "operation.update", map[string]any{"ID": p.ID, "Type": "verification", "Status": status, "Output": result.Output})
	a.events.enqueue(id, "verification.result", result)
	return result, nil
}
