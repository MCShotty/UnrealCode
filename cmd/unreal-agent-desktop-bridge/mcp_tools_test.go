package main

import (
	"github.com/unreallabsai/unreal-agent/harness/contextbuilder"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"strings"
	"testing"
	"uuid"
)

func TestMCPCatalogChangesBetweenRequestsAndKeepsHistory(t *testing.T) {
	c := newMCPCatalog("")
	id := session.ID(uuid.New().String())
	entry := catalogEntry{Name: "mcp_fixture_echo_abc", RemoteName: "echo", ConnectionID: "fixture", Revision: strings.Repeat("a", 64), Description: "echo focused text", InputSchema: map[string]any{"type": "object"}, Enabled: true}
	if err := c.configure([]catalogEntry{entry}); err != nil {
		t.Fatal(err)
	}
	b := &catalogBuilder{Builder: contextbuilder.NewBuilder(), catalog: c, id: id, mode: "ask"}
	before, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Request.Tools) != 0 {
		t.Fatal("MCP schemas loaded before discovery")
	}
	if len(c.search(id, "focused", nil)) != 1 {
		t.Fatal("catalog search failed")
	}
	after, _ := b.Build()
	if len(after.Request.Tools) != 1 {
		t.Fatal("schema was not exposed after discovery")
	}
	if err := c.configure(nil); err != nil {
		t.Fatal(err)
	}
	revoked, _ := b.Build()
	if len(revoked.Request.Tools) != 0 {
		t.Fatal("revoked schema remained exposed")
	}
	r := &mcpRegistry{catalog: c, mode: "ask"}
	translator, ok := r.Resolve(entry.Name)
	if !ok {
		t.Fatal("history translator lost")
	}
	if result := translator.Translate(nil, llm.ToolCall{Name: entry.Name, Arguments: `{}`}); result.Error == "" {
		t.Fatal("revoked tool accepted")
	}
	c.configure([]catalogEntry{entry})
	b.mode = "plan"
	plan, _ := b.Build()
	if len(plan.Request.Tools) != 0 {
		t.Fatal("Plan exposed external tools")
	}
	r.mode = "plan"
	translator, _ = r.Resolve(entry.Name)
	if translator.Translate(nil, llm.ToolCall{Arguments: `{}`}).Error == "" {
		t.Fatal("Plan accepted MCP")
	}
	// An in-flight request owns its definition snapshot even after catalog changes.
	if len(after.Request.Tools) != 1 || after.Request.Tools[0].Name != entry.Name {
		t.Fatal("earlier request mutated")
	}
}
func TestHostReplyRequiresExactLiveCorrelation(t *testing.T) {
	x := hostExchange{pending: map[string]hostPending{}}
	id := session.ID(uuid.New().String())
	op := operation.ID(uuid.New().String())
	key := uuid.New().String()
	ch := make(chan hostReply, 1)
	x.pending[key] = hostPending{session: id, operation: op, reply: ch}
	if x.resolve(hostReply{RequestID: key, SessionID: uuid.New().String(), OperationID: string(op)}) == nil {
		t.Fatal("wrong session accepted")
	}
	reply := hostReply{RequestID: key, SessionID: string(id), OperationID: string(op), Text: "complete"}
	if err := x.resolve(reply); err != nil {
		t.Fatal(err)
	}
	if (<-ch).Text != "complete" {
		t.Fatal("reply lost")
	}
	if x.resolve(reply) == nil {
		t.Fatal("duplicate reply accepted")
	}
}
