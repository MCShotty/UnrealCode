package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestOrdinaryOperations(t *testing.T) {
	root := t.TempDir()
	missing := "missing"
	q := request{Root: root, Path: "folder/data.txt", Method: "write", Data: []byte("original"), Expected: &missing}
	if _, err := execute(q); err != nil {
		t.Fatal(err)
	}
	q.Method = "read"
	q.Limit = 1024
	value, err := execute(q)
	if err != nil || string(value.Data) != "original" {
		t.Fatalf("read: %s %v", value.Data, err)
	}
	q.Method = "write"
	q.Data = []byte("stale")
	if _, err = execute(q); err == nil {
		t.Fatal("stale replacement allowed")
	}
	q.Expected = nil
	q.Method = "delete"
	if _, err = execute(q); err != nil {
		t.Fatal(err)
	}
	q.Method = "prune"
	if _, err = execute(q); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "folder")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal(err)
	}
}
func TestRejectLinksAndProtectedPaths(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "private"), []byte("outside"), 0600)
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil && runtime.GOOS != "windows" {
		t.Fatal(err)
	}
	for _, name := range []string{"../private", ".git/config", "a/../../private", "link/private"} {
		if _, err := execute(request{Root: root, Path: name, Method: "read", Limit: 1024}); err == nil {
			t.Fatalf("allowed %s", name)
		}
	}
	os.WriteFile(filepath.Join(root, "ordinary"), []byte("safe"), 0600)
	if err := os.Link(filepath.Join(outside, "private"), filepath.Join(root, "hard")); err == nil {
		if _, err = execute(request{Root: root, Path: "hard", Method: "read", Limit: 1024}); err == nil {
			t.Fatal("hard link was read")
		}
	}
}
func TestPinnedParentSurvivesPathReplacement(t *testing.T) {
	root := t.TempDir()
	os.Mkdir(filepath.Join(root, "parent"), 0700)
	os.WriteFile(filepath.Join(root, "parent", "file"), []byte("safe"), 0600)
	roots, _, err := openParents(request{Root: root, Path: "parent/file"}, false)
	if err != nil {
		t.Fatal(err)
	}
	defer closeRoots(roots)
	if err = os.Rename(filepath.Join(root, "parent"), filepath.Join(root, "moved")); err == nil {
		os.Mkdir(filepath.Join(root, "parent"), 0700)
		os.WriteFile(filepath.Join(root, "parent", "file"), []byte("replaced"), 0600)
	}
	bytes, _, err := read(roots[len(roots)-1], "file", 1024)
	if err != nil || string(bytes) != "safe" {
		t.Fatalf("pinned read: %q %v", bytes, err)
	}
}
func TestConcurrentParentSwapNeverReadsOutside(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	parent := filepath.Join(root, "parent")
	moved := filepath.Join(root, "moved")
	os.Mkdir(parent, 0700)
	os.WriteFile(filepath.Join(parent, "data"), []byte("safe"), 0600)
	os.WriteFile(filepath.Join(outside, "data"), []byte("outside"), 0600)
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-done:
				return
			default:
			}
			if os.Rename(parent, moved) == nil {
				if os.Symlink(outside, parent) == nil {
					os.Remove(parent)
				}
				os.Rename(moved, parent)
			}
		}
	}()
	for i := 0; i < 300; i++ {
		v, err := execute(request{Root: root, Path: "parent/data", Method: "read", Limit: 1024})
		if err == nil && strings.Contains(string(v.Data), "outside") {
			close(done)
			wg.Wait()
			t.Fatal("escaped project")
		}
	}
	close(done)
	wg.Wait()
}
