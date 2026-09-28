//go:build linux

package main

import (
	"strings"
	"testing"
)

func TestBridgeLeaseRejectsAnotherWriterAndReleasesOnClose(t *testing.T) {
	state := t.TempDir()
	first, err := acquireBridgeLease(state)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireBridgeLease(state); err == nil {
		second.Close()
		t.Fatal("second bridge acquired the same session volume")
	} else if !strings.Contains(err.Error(), "another UnrealCode backend") {
		t.Fatalf("unexpected lock error: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	third, err := acquireBridgeLease(state)
	if err != nil {
		t.Fatalf("stale lock blocked restart: %v", err)
	}
	third.Close()
}
