package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/unreallabsai/unreal-agent/harness/session"
)

// This projection is derived from durable events. It never resumes execution.
// A tool error is evidence for the turn, not a fatal coordinator error.
type turnOutcome struct {
	State      string    `json:"state"`
	TurnID     string    `json:"turnId,omitempty"`
	MessageIDs []string  `json:"messageIds,omitempty"`
	Warnings   []string  `json:"warnings,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt"`
}
type lifecycle struct {
	ProjectionVersion int               `json:"projectionVersion"`
	Outcome           turnOutcome       `json:"outcome"`
	Calls             map[string]string `json:"calls"`
	Failures          map[string]string `json:"failures"`
	Pending           map[string]bool   `json:"pending"`
	Waiting           map[string]bool   `json:"waiting"`
	Open              bool              `json:"open"`
	Size              int64             `json:"size"`
}

func object(v any) map[string]any { m, _ := v.(map[string]any); return m }
func prop(v any, key string) any {
	m := object(v)
	if x, ok := m[key]; ok {
		return x
	}
	return m[strings.ToLower(key[:1])+key[1:]]
}
func str(v any) string  { s, _ := v.(string); return s }
func array(v any) []any { a, _ := v.([]any); return a }
func freshLifecycle() *lifecycle {
	return &lifecycle{ProjectionVersion: 4, Outcome: turnOutcome{State: "idle"}, Calls: map[string]string{}, Failures: map[string]string{}, Waiting: map[string]bool{}, Pending: map[string]bool{}}
}
func (s *lifecycle) consume(kind string, p map[string]any, at time.Time) {
	if s.Calls == nil {
		s.Calls = map[string]string{}
	}
	if s.Failures == nil {
		s.Failures = map[string]string{}
	}
	if s.Waiting == nil {
		s.Waiting = map[string]bool{}
	}
	if s.Pending == nil {
		s.Pending = map[string]bool{}
	}
	if kind == "session.item" {
		d := prop(p, "Data")
		switch str(prop(p, "Kind")) {
		case "fork":
			*s = *freshLifecycle()
		case "input":
			if str(prop(d, "Kind")) != "external" {
				break
			}
			if !s.Open {
				*s = *freshLifecycle()
				s.Open = true
			}
			id := str(prop(d, "ID"))
			if id != "" && !slices.Contains(s.Outcome.MessageIDs, id) {
				s.Outcome.MessageIDs = append(s.Outcome.MessageIDs, id)
			}
			if id != "" {
				s.Pending[id] = true
			}
			s.Outcome.State = "running"
		case "turn":
			s.Outcome.TurnID = str(prop(d, "ID"))
		case "model_response":
			if prop(prop(d, "Response"), "Failure") != nil || str(prop(prop(d, "Response"), "Stop")) == "refused" {
				s.Outcome.State = "failed"
				s.Open = false
			}
			for _, out := range array(prop(prop(d, "Response"), "Output")) {
				if str(prop(out, "Type")) == "tool_call" {
					call := prop(out, "Data")
					args := str(prop(call, "Arguments"))
					var normalized any
					if json.Unmarshal([]byte(args), &normalized) == nil {
						b, _ := json.Marshal(normalized, json.Deterministic(true))
						args = string(b)
					}
					sum := sha256.Sum256([]byte(str(prop(call, "Name")) + "\n" + args))
					s.Calls[str(prop(d, "TurnID"))+":"+str(prop(call, "CallID"))] = hex.EncodeToString(sum[:])
				}
			}
		case "tool_call_status":
			key := str(prop(d, "TurnID")) + ":" + str(prop(d, "CallID"))
			signature := s.Calls[key]
			if signature == "" {
				signature = key
			}
			status := prop(d, "Status")
			failed := str(prop(status, "Error")) != ""
			pending := false
			for _, op := range array(prop(d, "Operations")) {
				state := str(prop(op, "Status"))
				// A shell process can complete normally with a failing exit code.
				if code, ok := prop(prop(prop(op, "State"), "Result"), "ExitCode").(float64); ok && code != 0 {
					failed = true
				}
				if state == "failed" {
					failed = true
				}
				if state != "completed" && state != "failed" && state != "canceled" {
					pending = true
				}
			}
			if failed {
				s.Failures[signature] = str(prop(d, "CallID"))
			} else if !pending && (len(array(prop(status, "WaitingFor"))) == 0 || len(array(prop(d, "Operations"))) > 0) {
				delete(s.Failures, signature)
			}
		}
	}
	if kind == "session.needs_input" || kind == "permission.requested" {
		id := str(prop(p, "OperationId"))
		if id == "" {
			id = str(p["operationId"])
		}
		s.Waiting[id] = true
		if s.Open {
			s.Outcome.State = "waiting_input"
		}
	}
	if kind == "question.updated" {
		id := str(p["id"])
		if p["mode"] == "required" && p["state"] == "pending" {
			s.Waiting[id] = true
		} else {
			delete(s.Waiting, id)
		}
		if s.Open {
			s.Outcome.State = "running"
			if len(s.Waiting) > 0 {
				s.Outcome.State = "waiting_input"
			}
		}
	}
	if kind == "operation.update" && slices.Contains([]string{"completed", "failed", "canceled"}, str(prop(p, "Status"))) {
		delete(s.Waiting, str(prop(p, "ID")))
		if s.Open && len(s.Waiting) == 0 {
			s.Outcome.State = "running"
		}
	}
	if kind == "permission.resolved" || kind == "host.resolved" {
		delete(s.Waiting, str(p["operationId"]))
		if s.Open && len(s.Waiting) == 0 {
			s.Outcome.State = "running"
		}
	}
	if kind == "session.activity" && p["busy"] == true && s.Open {
		s.Outcome.State = "running"
		if len(s.Waiting) > 0 {
			s.Outcome.State = "waiting_input"
		}
	}
	if kind == "hook.failed" {
		s.Failures["hook:"+str(p["operationId"])] = str(p["operationId"])
	}
	if kind == "verification.result" {
		if p["cancelled"] == true {
			s.Outcome.State = "stopped"
		} else if code, ok := p["exitCode"].(float64); ok && code != 0 {
			s.Outcome.State = "failed"
		} else if !s.Open {
			s.Outcome.State = "completed"
			if len(s.Failures) > 0 {
				s.Outcome.State = "completed_with_warnings"
			}
		}
	}
	if kind == "session.idle" && s.Open {
		for _, id := range array(p["messageIds"]) {
			delete(s.Pending, str(id))
		}
		for _, reason := range array(p["hookFailures"]) {
			s.Failures["hook:"+str(reason)] = str(reason)
		}
		if len(s.Pending) > 0 {
			s.Outcome.State = "running"
			s.Outcome.UpdatedAt = at
			return
		}
		s.Outcome.State = "completed"
		s.Outcome.Warnings = nil
		for _, id := range s.Failures {
			s.Outcome.Warnings = append(s.Outcome.Warnings, id)
		}
		slices.Sort(s.Outcome.Warnings)
		if len(s.Outcome.Warnings) > 0 {
			s.Outcome.State = "completed_with_warnings"
		}
		s.Open = false
	}
	if kind == "session.status" {
		status := str(p["status"])
		if status == "error" {
			s.Outcome.State = "failed"
			s.Open = false
		} else if status == "stopped" && s.Open {
			s.Outcome.State = "stopped"
			s.Open = false
		}
	}
	s.Outcome.UpdatedAt = at
}
func (l *eventLog) lifecycleLocked(id session.ID) (*lifecycle, error) {
	if l.outcomes == nil {
		l.outcomes = map[session.ID]*lifecycle{}
	}
	if value := l.outcomes[id]; value != nil {
		return value, nil
	}
	value := freshLifecycle()
	if data, err := os.ReadFile(l.path(id) + ".summary.json"); err == nil {
		var cached lifecycle
		info, statErr := os.Stat(l.path(id))
		if json.Unmarshal(data, &cached) == nil && cached.ProjectionVersion == 4 && statErr == nil && cached.Size == info.Size() && cached.Calls != nil && cached.Failures != nil && cached.Waiting != nil && cached.Pending != nil && cached.Outcome.State != "" {
			l.outcomes[id] = &cached
			return &cached, nil
		}
	}
	entries, err := l.readLocked(id)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		var p map[string]any
		if json.Unmarshal(entry.Payload, &p) == nil {
			value.consume(entry.Event, p, entry.RecordedAt)
		}
	}
	l.outcomes[id] = value
	l.saveLifecycleLocked(id, value)
	return value, nil
}
func (l *eventLog) outcome(id session.ID, active bool) (turnOutcome, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	value, err := l.lifecycleLocked(id)
	if err != nil {
		return turnOutcome{}, err
	}
	result := value.Outcome
	if !active && (value.Open || result.State == "running" || result.State == "waiting_input") {
		result.State = "interrupted"
	}
	return result, nil
}
func (l *eventLog) saveLifecycleLocked(id session.ID, value *lifecycle) {
	info, err := os.Stat(l.path(id))
	if err != nil {
		return
	}
	value.Size = info.Size()
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	path := l.path(id) + ".summary.json"
	if os.WriteFile(path+".tmp", data, 0o600) == nil {
		_ = os.Rename(path+".tmp", path)
	}
}
