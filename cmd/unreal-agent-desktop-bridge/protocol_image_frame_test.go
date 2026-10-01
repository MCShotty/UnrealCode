package main

import (
	"strings"
	"testing"
)

func TestValidImageAndPromptEnvelopeFitsProtocolFrame(t *testing.T) {
	// Image strings are bounded at 8 MiB, independently of the prompt. Their
	// combined envelope exceeded the old scanner bound and disconnected the app.
	frame := `{"v":1,"id":"fixture","method":"session.send","params":{"images":["data:image/png;base64,` + strings.Repeat("A", 8*1024*1024-22) + `"],"prompt":"` + strings.Repeat("p", 100*1024) + `"}}` + "\n"
	count := 0
	if err := readRequests(strings.NewReader(frame), func(request) { count++ }); err != nil || count != 1 {
		t.Fatalf("valid frame rejected: %v count=%d", err, count)
	}
}
