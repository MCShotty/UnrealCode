package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/unreallabsai/unreal-agent/harness/session"
)

func TestEventLogPreservesAndRepairsIncompleteCrashTail(t *testing.T) {
	dir := t.TempDir()
	id := session.ID("d4cfdab7-d8b3-4507-b3cc-7a4fc030108a")
	first, err := newEventLog(dir, &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 2 {
		if err := first.append(id, "fixture", map[string]int{"index": i}, 0); err != nil {
			t.Fatal(err)
		}
	}
	f, err := os.OpenFile(first.path(id), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte(`{"v":1,"event":"fixture","payload":{"incomplete":`)); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := newEventLog(dir, &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	entries, err := restarted.entries(id, 0, 10)
	if err != nil || len(entries) != 2 {
		t.Fatalf("complete events were lost: length=%d error=%v", len(entries), err)
	}
	partials, err := filepath.Glob(first.path(id) + ".partial-*")
	if err != nil || len(partials) != 1 {
		t.Fatalf("incomplete bytes were not retained: backups=%d error=%v", len(partials), err)
	}
	partial, err := os.ReadFile(partials[0])
	if err != nil || !bytes.Contains(partial, []byte(`"incomplete"`)) {
		t.Fatal("saved crash fragment is missing")
	}
	if err := restarted.append(id, "fixture", map[string]int{"index": 2}, 0); err != nil {
		t.Fatal(err)
	}
	entries, err = restarted.latest(id, 10)
	if err != nil || len(entries) != 3 || entries[2].Sequence != 3 {
		t.Fatalf("new events did not follow recovered sequence: length=%d error=%v", len(entries), err)
	}
}

func TestEventLogCompletesValidLineMissingFinalNewline(t *testing.T) {
	dir := t.TempDir()
	id := session.ID("2e57a8d0-fd75-499e-a560-e2d552c4f723")
	first, err := newEventLog(dir, &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.append(id, "fixture", map[string]int{"index": 1}, 0); err != nil {
		t.Fatal(err)
	}
	path := first.path(id)
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data[:len(data)-1], 0o600); err != nil {
		t.Fatal(err)
	}
	restarted, err := newEventLog(dir, &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.append(id, "fixture", map[string]int{"index": 2}, 0); err != nil {
		t.Fatal(err)
	}
	entries, err := restarted.entries(id, 0, 10)
	if err != nil || len(entries) != 2 || entries[1].Sequence != 2 {
		t.Fatalf("valid line was not separated from next event: length=%d error=%v", len(entries), err)
	}
}

func TestEventLogDoesNotDiscardCompleteMalformedLine(t *testing.T) {
	dir := t.TempDir()
	id := session.ID("faaf6fab-07f3-46a0-9d96-d40d0ebeb22a")
	log, err := newEventLog(dir, &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := log.append(id, "fixture", map[string]int{"index": 1}, 0); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(log.path(id), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("malformed complete record\n")); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := newEventLog(dir, &output{w: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.entries(id, 0, 10); err == nil {
		t.Fatal("complete malformed record was silently discarded")
	}
}
