package main

import (
	"encoding/json/v2"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"os"
	"path/filepath"
	"slices"
	"uuid"
)

// Rebuilding a status does not restore an executable job. The advisory's actual
// delivered record is authoritative if the process died before its status flush.
func (a *app) recoverAdvisories() {
	dir := filepath.Join(a.events.dir, "advisories-v1")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() > 16384 {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var value advisoryStatus
		if json.Unmarshal(data, &value) != nil || value.Version != 1 || !slices.Contains([]string{"queued", "analysing", "ready"}, value.State) {
			continue
		}
		id := session.ID(value.Binding.SessionID)
		if _, err := uuid.Parse(string(id)); err != nil || entry.Name() != string(id)+".json" {
			continue
		}
		value.State = "interrupted"
		value.Message = "Background advice was interrupted. Execution has not resumed."
		if restored, err := a.store.Resume(a.ctx, id); err == nil && slices.Contains(restored.AdvisoryInputIDs, value.ID) {
			value.State = "delivered"
			value.Message = ""
		}
		_ = a.events.append(id, "decision.advisory", value, 0)
	}
}
