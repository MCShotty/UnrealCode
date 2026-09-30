package main

import (
	"context"
	"encoding/base64"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"strings"
	"testing"
	"time"
	"uuid"
)

func TestComputerImagesPreserveCanonicalReferences(t *testing.T) {
	// Malformed/foreign refs must turn into a readable fallback, never be passed
	// to a provider as a remote URL, and must not mutate stored history slices.
	a := &app{}
	result := llm.ToolResult{CallID: "capture", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultText, Value: "observation"}, {Kind: llm.ToolResultImage, Value: "unrealcode://computer-image/invalid"}}}
	request := llm.Request{Input: []llm.Item{{Type: llm.ItemToolResult, Data: result}}}
	outgoing := a.resolveComputerImages(context.Background(), "session", "workspace", request)
	got := outgoing.Input[0].Data.(llm.ToolResult)
	if got.Output[1].Kind != llm.ToolResultText || !strings.Contains(got.Output[1].Value, "expired") {
		t.Fatalf("invalid screenshot not replaced: %+v", got)
	}
	if request.Input[0].Data.(llm.ToolResult).Output[1].Value != "unrealcode://computer-image/invalid" {
		t.Fatal("canonical history was mutated")
	}
}

func TestComputerImageReplyIsEphemeralAndBoundToSession(t *testing.T) {
	a, close, buffer, _ := testApp(t, t.TempDir(), false)
	defer close()
	id := session.ID(uuid.New().String())
	ref := uuid.New().String()
	request := llm.Request{Input: []llm.Item{{Type: llm.ItemToolResult, Data: llm.ToolResult{CallID: "fixture", Output: []llm.ToolResultOutput{{Kind: llm.ToolResultImage, Value: "unrealcode://computer-image/" + ref}}}}}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()
	done := make(chan llm.Request, 1)
	go func() { done <- a.resolveComputerImages(ctx, id, "fixture", request) }()
	var reply hostReply
	waitFor(t, func() bool {
		a.host.mu.Lock()
		defer a.host.mu.Unlock()
		for key, p := range a.host.pending {
			reply = hostReply{RequestID: key, SessionID: string(p.session), OperationID: string(p.operation)}
			return true
		}
		return false
	})
	wrong := reply
	wrong.SessionID = uuid.New().String()
	if a.host.resolve(wrong) == nil {
		t.Fatal("foreign session accepted")
	}
	image := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfixture"))
	reply.Text = image
	if err := a.host.resolve(reply); err != nil {
		t.Fatal(err)
	}
	outgoing := <-done
	if outgoing.Input[0].Data.(llm.ToolResult).Output[0].Value != image {
		t.Fatal("outgoing request did not receive the authorized image")
	}
	if strings.Contains(request.Input[0].Data.(llm.ToolResult).Output[0].Value, "base64") {
		t.Fatal("canonical context contains image bytes")
	}
	a.events.flush()
	if strings.Contains(buffer.String(), image) {
		t.Fatal("image bytes leaked into bridge event output")
	}
	events, err := a.events.entries(id, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatal("temporary image exchange became durable")
	}
}
