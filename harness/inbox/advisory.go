package inbox

import (
	"encoding/json/v2"
	"fmt"
	"strings"
)

// Binding is an opaque host-owned identity. The coordinator additionally checks
// SourceInputID against its latest external input, including during replay.
type AdvisoryBinding struct {
	ProjectID          string `json:"projectId"`
	WorkspaceID        string `json:"workspaceId"`
	SessionID          string `json:"sessionId"`
	RunID              string `json:"runId"`
	SourceInputID      ID     `json:"sourceInputId"`
	RequestGeneration  uint64 `json:"requestGeneration"`
	DecisionGeneration uint64 `json:"decisionGeneration"`
	ContextRevision    uint64 `json:"contextRevision"`
}

type Advisory struct {
	Version  int             `json:"version"`
	Category string          `json:"category,omitempty"`
	Binding  AdvisoryBinding `json:"binding"`
	Text     string          `json:"text"`
}

func (input Input) DecodeAdvisory() (Advisory, error) {
	var value Advisory
	if input.Kind != InputAdvisory {
		return value, fmt.Errorf("advisory has kind %q", input.Kind)
	}
	if err := json.Unmarshal(input.Payload, &value, json.RejectUnknownMembers(true)); err != nil {
		return value, fmt.Errorf("decode advisory: %w", err)
	}
	b := value.Binding
	if value.Category != "" && value.Category != "decision" && value.Category != "memory" {
		return value, fmt.Errorf("unsupported advisory category")
	}
	if value.Version != 1 || b.ProjectID == "" || b.WorkspaceID == "" || b.SessionID == "" || b.RunID == "" || b.SourceInputID == "" || b.RequestGeneration == 0 || b.DecisionGeneration == 0 || b.ContextRevision == 0 || strings.TrimSpace(value.Text) == "" || len(value.Text) > 8192 {
		return value, fmt.Errorf("invalid or unsupported advisory envelope")
	}
	return value, nil
}
