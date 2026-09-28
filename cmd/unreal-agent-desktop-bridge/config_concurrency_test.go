package main

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/unreallabsai/unreal-agent/harness/session"
)

func TestConcurrentSessionConfigWritesUseIndependentTemporaryFiles(t *testing.T) {
	a := &app{root: t.TempDir()}
	id := session.ID("a748e7c7-2895-4f38-8863-65ffb5dd20e1")
	const writers = 24
	start := make(chan struct{})
	errors := make(chan error, writers)
	var done sync.WaitGroup
	for i := range writers {
		done.Add(1)
		go func() {
			defer done.Done()
			<-start
			errors <- a.saveConfig(id, sessionConfig{Title: fmt.Sprintf("title-%d", i), SystemPrompt: strings.Repeat("x", 128*1024)})
		}()
	}
	close(start)
	done.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent config write: %v", err)
		}
	}
	config, err := a.loadConfig(id)
	if err != nil || !strings.HasPrefix(config.Title, "title-") || len(config.SystemPrompt) != 128*1024 {
		t.Fatalf("final session config is invalid: title=%q length=%d error=%v", config.Title, len(config.SystemPrompt), err)
	}
}

func TestConcurrentConfigUpdatesPreserveUnrelatedFields(t *testing.T) {
	a := &app{root: t.TempDir()}
	id := session.ID("70caf8b5-347e-4e2d-a608-b4fadf71f401")
	if err := a.saveConfig(id, sessionConfig{Mode: "ask"}); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errors := make(chan error, 2)
	var done sync.WaitGroup
	for _, change := range []func(*sessionConfig) error{
		func(config *sessionConfig) error { config.Title = "New title"; return nil },
		func(config *sessionConfig) error { config.TeamEnabled = true; return nil },
	} {
		done.Add(1)
		go func(change func(*sessionConfig) error) {
			defer done.Done()
			<-start
			errors <- a.updateConfig(id, change)
		}(change)
	}
	close(start)
	done.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	config, err := a.loadConfig(id)
	if err != nil || config.Title != "New title" || !config.TeamEnabled || config.Mode != "ask" {
		t.Fatalf("concurrent updates lost config fields: title=%q team=%v mode=%q error=%v", config.Title, config.TeamEnabled, config.Mode, err)
	}
}
