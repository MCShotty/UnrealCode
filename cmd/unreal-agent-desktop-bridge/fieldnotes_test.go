package main

import (
	"encoding/json/v2"
	"github.com/unreallabsai/unreal-agent/harness/contextbuilder"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"strings"
	"testing"
	"uuid"
)

func guidanceText(request llm.Request) string {
	var text strings.Builder
	for _, item := range request.Input {
		if message, ok := item.Data.(llm.Message); ok {
			text.WriteString(message.Text)
		}
	}
	return text.String()
}
func TestFieldnotesAreProjectedOnceWithoutPollutingHistory(t *testing.T) {
	id, message, noteID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	authority := &fieldnoteAuthority{}
	if err := authority.configure([]fieldnoteRef{{ID: noteID, Revision: 1, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	b := &catalogBuilder{Builder: contextbuilder.NewBuilder(), id: session.ID(id), mode: "plan", guidance: authority}
	receipt := &fieldnoteReceipt{SessionID: id, MessageID: message, Notes: []fieldnoteSnapshot{{ID: noteID, Revision: 1, Text: "Prefer local SQLite", Pointer: map[string]string{"projectPath": "source-project"}}}}
	payload, _ := json.Marshal(map[string]any{"prompt": "Inspect storage", "fieldnotes": receipt})
	if err := b.AddExternalInput(inbox.Input{ID: inbox.ID(message), Kind: inbox.InputExternal, Payload: payload}); err != nil {
		t.Fatal(err)
	}
	raw, _ := b.Builder.Build()
	if strings.Contains(guidanceText(raw.Request), "Prefer local SQLite") {
		t.Fatal("advisory text entered ordinary history")
	}
	for range 3 {
		projected, err := b.Build()
		if err != nil {
			t.Fatal(err)
		}
		text := guidanceText(projected.Request)
		if strings.Count(text, "<unrealcode_fieldnotes>") != 1 || !strings.Contains(text, "Prefer local SQLite") {
			t.Fatal("missing or duplicated guidance")
		}
	}
	if err := authority.configure([]fieldnoteRef{{ID: noteID, Revision: 2, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	projected, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	text := guidanceText(projected.Request)
	if strings.Contains(text, "Prefer local SQLite") || !strings.Contains(text, "retiredGuidance") {
		t.Fatal("withdrawn guidance was retained or lost provenance")
	}
}
func TestFieldnotesRetainForkProvenanceAndRejectNewIngressMismatch(t *testing.T) {
	parent, child, message, note := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	receipt := &fieldnoteReceipt{SessionID: parent, MessageID: message, Notes: []fieldnoteSnapshot{{ID: note, Revision: 1, Text: "Guidance"}}}
	if validateFieldnoteReceipt(receipt, child, message) == nil {
		t.Fatal("new ingress accepted another session's receipt")
	}
	payload, _ := json.Marshal(map[string]any{"prompt": "Parent request", "fieldnotes": receipt})
	b := &catalogBuilder{Builder: contextbuilder.NewBuilder(), id: session.ID(child), mode: "plan"}
	if err := b.AddExternalInput(inbox.Input{ID: inbox.ID(message), Kind: inbox.InputExternal, Payload: payload}); err != nil {
		t.Fatal("canonical fork replay failed:", err)
	}
	if len(b.guidanceDependencies()) != 1 {
		t.Fatal("fork lost provenance")
	}
	receipt.Notes[0].Text = strings.Repeat("a", 16*1024+1)
	if validateFieldnoteReceipt(receipt, parent, message) == nil {
		t.Fatal("oversized note accepted")
	}
}
func TestWithdrawnGuidanceInvalidatesDerivedSummary(t *testing.T) {
	note := uuid.New().String()
	b := &catalogBuilder{Builder: contextbuilder.NewBuilder(), mode: "plan", guidance: &fieldnoteAuthority{}, summary: &contextSummary{Text: "Old anonymous instructions", PrefixItems: 9, FieldnoteDependencies: []fieldnoteRef{{ID: note, Revision: 1}}}}
	result, err := b.Build()
	if err != nil {
		t.Fatal("retired summary should fall back to canonical context:", err)
	}
	if strings.Contains(guidanceText(result.Request), "Old anonymous instructions") {
		t.Fatal("retired summary leaked")
	}
}
