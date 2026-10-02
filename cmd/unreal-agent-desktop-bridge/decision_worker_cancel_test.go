package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func stalledDecisionWorker(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	path, pidPath := filepath.Join(dir, "stalled-worker"), filepath.Join(dir, "worker.pid")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho $$ > "+strconv.Quote(pidPath)+"\nexec sleep 60\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if raw, err := os.ReadFile(pidPath); err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(raw))); err == nil {
				if process, err := os.FindProcess(pid); err == nil {
					_ = process.Kill()
				}
			}
		}
	})
	return path, pidPath
}
func TestLocalDecisionWorkerCancelsWhileWaitingForAnotherRequest(t *testing.T) {
	path, pidPath := stalledDecisionWorker(t)
	worker := &pythonWorker{}
	first, cancelFirst := context.WithCancel(t.Context())
	defer cancelFirst()
	finished := make(chan error, 1)
	go func() { finished <- worker.call(first, path, "evaluate", "small input", new(any)) }()
	waitFor(t, func() bool { _, err := os.Stat(pidPath); return err == nil })
	second, cancelSecond := context.WithCancel(t.Context())
	cancelSecond()
	done := make(chan error, 1)
	go func() { done <- worker.call(second, path, "evaluate", "second input", new(any)) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("local worker lock waiter ignored cancellation")
	}
	cancelFirst()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("first worker did not settle")
	}
}
func TestLocalDecisionWorkerCancelsBlockedStdin(t *testing.T) {
	path, _ := stalledDecisionWorker(t)
	worker := &pythonWorker{}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- worker.call(ctx, path, "evaluate", strings.Repeat("x", 256*1024), new(any)) }()
	// Cancellation occurs while the child is not reading its input. A bounded
	// watchdog prevents a defective fixture from leaving the test suite stuck.
	time.AfterFunc(50*time.Millisecond, cancel)
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("local worker stdin blocked cancellation")
	}
	if worker.cmd != nil {
		t.Fatal("cancelled worker remained live")
	}
}
