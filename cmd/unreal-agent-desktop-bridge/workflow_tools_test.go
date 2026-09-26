package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectSearchHonorsExclusionsAndSymlinkTargets(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	for name, text := range map[string]string{"visible.txt": "first\nNeedle here", "excluded/private.txt": "needle", "binary.dat": "needle\x00", "node_modules/dependency.txt": "needle"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(outside, "outside.txt"), []byte("needle"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "outside.txt"), filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "excluded", "private.txt"), filepath.Join(root, "alias.txt")); err != nil {
		t.Fatal(err)
	}
	p := &contextPreferences{}
	if err := p.configure([]string{"excluded"}); err != nil {
		t.Fatal(err)
	}
	result, err := searchProject(context.Background(), root, p, "NEEDLE")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 1 || result.Matches[0].Path != "visible.txt" || result.Matches[0].Line != 2 {
		t.Fatalf("unexpected matches: %+v", result)
	}
}

func TestProjectSearchBoundsAndCancellation(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "large.txt"), []byte(strings.Repeat("needle\n", 101)), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := searchProject(context.Background(), root, &contextPreferences{}, "needle")
	if err != nil || len(result.Matches) != 100 || !result.Truncated {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := searchProject(ctx, root, &contextPreferences{}, "needle"); err == nil {
		t.Fatal("cancelled search succeeded")
	}
	for _, path := range []string{"../private", "C:/private", "a//b", "a/./b"} {
		if err := (&contextPreferences{}).configure([]string{path}); err == nil {
			t.Fatalf("accepted %q", path)
		}
	}
}
