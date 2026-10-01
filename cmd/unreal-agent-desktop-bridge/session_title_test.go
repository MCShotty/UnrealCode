package main

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSessionTitleExcludesAdvisoryContext(t *testing.T) {
	for _, marker := range []string{"context", "memory", "fieldnotes"} {
		input := "  Inspect\nproject  \n<unrealcode_" + marker + ">Internal advisory text"
		if got := sessionTitlePrompt(input); got != "Inspect project" {
			t.Fatalf("%s title = %q", marker, got)
		}
	}
}

func TestSessionTitleTruncatesCharactersWithoutBreakingArabic(t *testing.T) {
	got := sessionTitlePrompt(strings.Repeat("م", 60))
	if !utf8.ValidString(got) || got != strings.Repeat("م", 48)+"…" {
		t.Fatalf("Unicode title was damaged: %q", got)
	}
}
