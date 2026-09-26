package main

import (
	"context"
	"encoding/json"
	"encoding/json/jsontext"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestStoppingWaitsForContendedFileWriter(t *testing.T) {
	root := t.TempDir()
	locks := &fileLocks{}
	unlockZ := locks.lock([]string{"z"})
	release := sync.OnceFunc(unlockZ)
	defer release()
	locks.lock([]string{"a"})()
	locks.mu.Lock()
	aLock := locks.paths["a"]
	locks.mu.Unlock()
	h := newFileHandler(context.Background(), root, t.TempDir(), locks)
	data, _ := json.Marshal(fileArgs{Action: "patch", Edits: []fileEdit{{Path: "a", ExpectedRevision: "missing", Content: strptr("a")}, {Path: "z", ExpectedRevision: "missing", Content: strptr("z")}}})
	spec, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: filePlan, Version: 1, Data: jsontext.Value(data)})
	if err != nil {
		t.Fatal(err)
	}
	if err = h.AddRemoteJob(operation.Operation{ID: "stop-fixture", Type: spec.Type, Version: spec.Version, State: spec.State, MaxOutputLength: spec.MaxOutputLength, Status: operation.StatusReady}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		if aLock.TryLock() {
			aLock.Unlock()
			return false
		}
		return true
	})
	done := make(chan struct{})
	go func() { h.stop(); close(done) }()
	select {
	case <-done:
		t.Fatal("stop returned while a file writer was still active")
	case <-time.After(20 * time.Millisecond):
	}
	release()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("writer failed to settle")
	}
	if _, err = os.Stat(filepath.Join(root, "a")); !os.IsNotExist(err) {
		t.Fatal("cancelled writer changed project")
	}
}

func strptr(value string) *string { return &value }
func TestNativeFilePatchConflictsAndRecovery(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "a.txt"), []byte("before"), 0644)
	h := newFileHandler(context.Background(), root, recovery, &fileLocks{})
	_, err := h.execute(context.Background(), fileArgs{Action: "patch", Edits: []fileEdit{{Path: "a.txt", ExpectedRevision: revision([]byte("before")), Content: strptr("after")}, {Path: "new.txt", ExpectedRevision: "missing", Content: strptr("created")}}}, "one")
	if err != nil {
		t.Fatal(err)
	}
	bytes, _ := os.ReadFile(filepath.Join(root, "a.txt"))
	if string(bytes) != "after" {
		t.Fatal(string(bytes))
	}
	if _, err := os.Stat(filepath.Join(recovery, "one.json")); err != nil {
		t.Fatal("missing recovery copy")
	}
	_, err = h.execute(context.Background(), fileArgs{Action: "patch", Edits: []fileEdit{{Path: "new.txt", ExpectedRevision: revision([]byte("created")), Content: nil}, {Path: "a.txt", ExpectedRevision: revision([]byte("before")), Content: strptr("stale")}}}, "two")
	if err == nil {
		t.Fatal("stale revision accepted")
	}
	if _, err = os.Stat(filepath.Join(root, "new.txt")); err != nil {
		t.Fatal("partial edit applied before conflict validation")
	}
	_, err = h.execute(context.Background(), fileArgs{Action: "patch", Edits: []fileEdit{{Path: "new.txt", ExpectedRevision: revision([]byte("created")), Content: nil}}}, "three")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "new.txt")); !os.IsNotExist(err) {
		t.Fatal("delete failed")
	}
}
func TestNativeFileConcurrentWriters(t *testing.T) {
	root := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "a"), []byte("original"), 0644)
	h := newFileHandler(context.Background(), root, t.TempDir(), &fileLocks{})
	var passed atomic.Int32
	var group sync.WaitGroup
	for _, id := range []string{"one", "two"} {
		group.Add(1)
		go func(id string) {
			defer group.Done()
			_, err := h.execute(context.Background(), fileArgs{Action: "patch", Edits: []fileEdit{{Path: "a", ExpectedRevision: revision([]byte("original")), Content: strptr(id)}}}, id)
			if err == nil {
				passed.Add(1)
			}
		}(id)
	}
	group.Wait()
	if passed.Load() != 1 {
		t.Fatalf("expected one writer, got %d", passed.Load())
	}
}
func TestNativeFilesRejectEscapeAndCancelledWrites(t *testing.T) {
	for _, path := range []string{"../outside", ".git/config", "a/../../outside", "C:/secret", "a\\b"} {
		if filePath(path, false) == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	h := newFileHandler(context.Background(), root, t.TempDir(), &fileLocks{})
	if _, err := h.execute(context.Background(), fileArgs{Action: "read", Path: "link/secret"}, "read"); err == nil {
		t.Fatal("symlink accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := h.execute(ctx, fileArgs{Action: "patch", Edits: []fileEdit{{Path: "a", ExpectedRevision: "missing", Content: strptr("after")}}}, "cancel"); err == nil {
		t.Fatal("cancelled edit accepted")
	}
}
