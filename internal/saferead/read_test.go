package saferead

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegularFileBoundsAndTypes(t *testing.T) {
	directory := t.TempDir()
	exact := filepath.Join(directory, "exact.txt")
	oversized := filepath.Join(directory, "oversized.txt")
	if err := os.WriteFile(exact, []byte("12345678"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oversized, []byte("123456789"), 0o600); err != nil {
		t.Fatal(err)
	}
	contents, err := RegularFile(exact, 8)
	if err != nil || string(contents) != "12345678" {
		t.Fatalf("exact-size read = %q, %v", contents, err)
	}
	if _, err := RegularFile(oversized, 8); err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("oversized read error = %v", err)
	}
	if _, err := RegularFile(directory, 8); err == nil {
		t.Fatal("directory was accepted as a regular file")
	}
	if _, err := RegularFile(exact, 0); err == nil {
		t.Fatal("zero size limit was accepted")
	}
	linked := filepath.Join(directory, "linked.txt")
	if err := os.Symlink(exact, linked); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := RegularFile(linked, 8); err == nil {
		t.Fatal("symbolic link was accepted")
	}
}
