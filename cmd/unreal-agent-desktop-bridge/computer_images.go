package main

import (
	"context"
	"encoding/base64"
	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"strings"
	"time"
	"uuid"
)

// Captures are resolved only for the outgoing request. Canonical context keeps
// opaque references, so replay, compaction, backups and telemetry contain no PNG.
func (a *app) resolveComputerImages(ctx context.Context, id session.ID, workspace string, request llm.Request) llm.Request {
	request.Input = append([]llm.Item(nil), request.Input...)
	for i, item := range request.Input {
		result, ok := item.Data.(llm.ToolResult)
		if !ok {
			continue
		}
		result.Output = append([]llm.ToolResultOutput(nil), result.Output...)
		for j, output := range result.Output {
			const prefix = "unrealcode://computer-image/"
			if output.Kind != llm.ToolResultImage || !strings.HasPrefix(output.Value, prefix) {
				continue
			}
			ref := strings.TrimPrefix(output.Value, prefix)
			data := ""
			if _, err := uuid.Parse(ref); err == nil {
				data = a.computerImage(ctx, id, workspace, ref)
			}
			if strings.HasPrefix(data, "data:image/png;base64,") && len(data) <= 2*1024*1024 {
				if bytes, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, "data:image/png;base64,")); err == nil && len(bytes) > 8 && string(bytes[:8]) == "\x89PNG\r\n\x1a\n" {
					result.Output[j].Value = data
					continue
				}
			}
			result.Output[j] = llm.ToolResultOutput{Kind: llm.ToolResultText, Value: "Computer screenshot expired or access changed. No image was sent. Ask for a fresh authorized observation if needed."}
		}
		request.Input[i].Data = result
	}
	return request
}

func (a *app) computerImage(ctx context.Context, id session.ID, workspace, ref string) string {
	requestID := uuid.New().String()
	op := operation.ID(uuid.New().String())
	reply := make(chan hostReply, 1)
	a.host.mu.Lock()
	if a.host.pending == nil {
		a.host.pending = map[string]hostPending{}
	}
	a.host.pending[requestID] = hostPending{session: id, operation: op, reply: reply}
	a.host.mu.Unlock()
	defer func() { a.host.mu.Lock(); delete(a.host.pending, requestID); a.host.mu.Unlock() }()
	// preview sends a transient bridge event; it does not enqueue a session record.
	a.events.preview(id, "computer.image.request", map[string]any{"requestId": requestID, "operationId": op, "sessionId": id, "workspaceId": workspace, "imageRef": ref})
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case result := <-reply:
		if !result.Error {
			return result.Text
		}
	case <-ctx.Done():
	case <-timer.C:
	}
	return ""
}
