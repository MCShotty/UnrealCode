package main

import (
	"context"
	"encoding/json"
	"encoding/json/jsontext"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

const workflowPlan operation.RemoteJobPlanType = "unrealcode.workflow"

type contextPreferences struct {
	mu       sync.RWMutex
	excluded []string
}

func (p *contextPreferences) configure(values []string) error {
	if len(values) > 100 {
		return errors.New("too many context exclusions")
	}
	for _, value := range values {
		if value == "" || filepath.IsAbs(value) || strings.Contains(value, "\\") || strings.Contains(value, ":") {
			return errors.New("invalid context exclusion")
		}
		for _, part := range strings.Split(value, "/") {
			if part == ".." || part == "." || part == "" {
				return errors.New("invalid context exclusion")
			}
		}
	}
	p.mu.Lock()
	p.excluded = append([]string(nil), values...)
	p.mu.Unlock()
	return nil
}
func (p *contextPreferences) excludes(path string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	path = strings.ToLower(filepath.ToSlash(path))
	for _, value := range append([]string{".git", "node_modules", ".venv", "__pycache__"}, p.excluded...) {
		value = strings.ToLower(value)
		if path == value || strings.HasPrefix(path, value+"/") {
			return true
		}
	}
	return false
}

type workflowArgs struct {
	Action     string         `json:"action"`
	Query      string         `json:"query"`
	Question   string         `json:"question"`
	Choices    []string       `json:"choices,omitempty"`
	Mode       string         `json:"mode,omitempty"`
	Questions  []questionItem `json:"questions,omitempty"`
	QuestionID string         `json:"questionId,omitempty"`
}
type workflowTranslator struct{ action string }

func workflowTools() []tool.ExtraStaticTool {
	return []tool.ExtraStaticTool{
		{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: "ProjectSearch", Description: "Search project text for a literal query, honoring the user's context exclusions. Prefer this for automatic source retrieval. Results include paths and line numbers; exclusions are context preferences, not filesystem permissions.", Parameters: map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}, "required": []any{"query"}}}}, Translator: workflowTranslator{"search"}},
		{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: "RequestInput", Description: "Ask one to three questions. Required mode waits for the user's explicit answers; background mode lets you continue independent work. Use WaitForInput when a background answer becomes necessary. Answers never grant tool permissions.", Parameters: questionSchema()}}, Translator: workflowTranslator{"input"}},
		{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: "WaitForInput", Description: "Wait for an existing background question without asking again. Independent operations continue.", Parameters: map[string]any{"type": "object", "properties": map[string]any{"questionId": map[string]any{"type": "string"}}, "required": []string{"questionId"}}}}, Translator: workflowTranslator{"wait_input"}},
	}
}
func (t workflowTranslator) Translate(ctx tool.Context, call llm.ToolCall) tool.CallStatus {
	var args workflowArgs
	if len(call.Arguments) > 8192 || json.Unmarshal([]byte(call.Arguments), &args) != nil {
		return tool.CallStatus{Error: "Invalid workflow tool arguments"}
	}
	args.Action = t.action
	if t.action == "search" && (strings.TrimSpace(args.Query) == "" || len(args.Query) > 500) {
		return tool.CallStatus{Error: "Search needs a query below 500 bytes"}
	}
	if t.action == "input" {
		if err := normalizeQuestions(&args); err != nil {
			return tool.CallStatus{Error: err.Error()}
		}
	}
	if t.action == "wait_input" && args.QuestionID == "" {
		return tool.CallStatus{Error: "Choose an existing question ID"}
	}
	encoded, _ := json.Marshal(args)
	spec, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: workflowPlan, Version: 1, Data: jsontext.Value(encoded)})
	if err != nil {
		return tool.CallStatus{Error: err.Error()}
	}
	return tool.CallStatus{WaitingFor: []operation.ID{ctx.Submit(spec)}}
}
func (t workflowTranslator) TranslateResult(id string, status tool.CallStatus, values []operation.Operation) (llm.ToolResult, error) {
	return (decisionToolTranslator{}).TranslateResult(id, status, values)
}

type workflowHandler struct {
	ctx              context.Context
	preferences      *contextPreferences
	workspace        string
	workspaceID      string
	questions        *questionLedger
	waitingQuestions map[operation.ID]string
	events           *eventLog
	session          session.ID
	mu               sync.Mutex
	waiting          map[operation.ID]operation.Operation
	cancels          map[operation.ID]context.CancelFunc
	updates          chan operation.Operation
	queueMu          sync.Mutex
	queue            []operation.Operation
	wake             chan struct{}
}

func newWorkflowHandler(ctx context.Context, p *contextPreferences, workspace string, events *eventLog, id session.ID) *workflowHandler {
	h := &workflowHandler{ctx: ctx, preferences: p, workspace: workspace, events: events, session: id, waiting: make(map[operation.ID]operation.Operation), cancels: make(map[operation.ID]context.CancelFunc), updates: make(chan operation.Operation), wake: make(chan struct{}, 1)}
	go h.forward()
	return h
}
func (h *workflowHandler) RemoteJobPlanType() operation.RemoteJobPlanType       { return workflowPlan }
func (h *workflowHandler) RemoteJobPlanVersion() operation.RemoteJobPlanVersion { return 1 }
func (h *workflowHandler) RemoteJobUpdates() <-chan operation.Operation         { return h.updates }
func (h *workflowHandler) publish(value operation.Operation) {
	h.queueMu.Lock()
	h.queue = append(h.queue, value)
	h.queueMu.Unlock()
	select {
	case h.wake <- struct{}{}:
	default:
	}
}
func (h *workflowHandler) forward() {
	defer close(h.updates)
	for {
		h.queueMu.Lock()
		if len(h.queue) > 0 {
			value := h.queue[0]
			h.queue[0] = operation.Operation{}
			h.queue = h.queue[1:]
			h.queueMu.Unlock()
			select {
			case h.updates <- value:
			case <-h.ctx.Done():
				return
			}
			continue
		}
		h.queueMu.Unlock()
		select {
		case <-h.wake:
		case <-h.ctx.Done():
			return
		}
	}
}
func (h *workflowHandler) AddRemoteJob(value operation.Operation) error {
	state, err := operation.DecodeRemoteJobState(value)
	if err != nil {
		return err
	}
	var args workflowArgs
	if json.Unmarshal(state.Plan.Data, &args) != nil {
		return errors.New("invalid workflow plan")
	}
	if args.Action == "input" || args.Action == "wait_input" {
		var q questionRequest
		if args.Action == "input" {
			if err = normalizeQuestions(&args); err != nil {
				return err
			}
			q, err = h.questions.create(h.session, h.workspaceID, string(value.ID), args)
		} else {
			q, err = h.questions.promote(h.session, args.QuestionID)
		}
		if err != nil {
			return err
		}
		if q.State != "pending" || q.Mode == "background" {
			encoded, _ := json.Marshal(q)
			state.TerminalResult = string(encoded)
			step, err := operation.UpdateRemoteJob(value, state, operation.StatusCompleted)
			if err == nil {
				h.publish(*step.Operation)
			}
			return err
		}
		step, err := operation.UpdateRemoteJob(value, state, operation.StatusAwaiting)
		if err != nil {
			return err
		}
		h.mu.Lock()
		h.waiting[value.ID] = *step.Operation
		if h.waitingQuestions == nil {
			h.waitingQuestions = map[operation.ID]string{}
		}
		h.waitingQuestions[value.ID] = q.ID
		h.publish(*step.Operation)
		h.mu.Unlock()
		h.events.enqueue(h.session, "session.needs_input", map[string]any{"questionId": q.ID, "question": q.Questions[0].Title, "operationId": value.ID})
		return nil
	}
	if args.Action != "search" {
		return errors.New("unsupported workflow action")
	}
	ctx, cancel := context.WithCancel(h.ctx)
	h.mu.Lock()
	h.cancels[value.ID] = cancel
	h.mu.Unlock()
	go func() {
		defer func() { cancel(); h.mu.Lock(); delete(h.cancels, value.ID); h.mu.Unlock() }()
		result, err := searchProject(ctx, h.workspace, h.preferences, args.Query)
		var step operation.Step
		if ctx.Err() != nil {
			step, err = operation.CancelRemoteJob(value)
		} else if err != nil {
			step, err = operation.FailRemoteJob(value, err)
		} else {
			encoded, _ := json.Marshal(result)
			state.TerminalResult = string(encoded)
			step, err = operation.UpdateRemoteJob(value, state, operation.StatusCompleted)
		}
		if err == nil {
			h.publish(*step.Operation)
		}
	}()
	return nil
}
func (h *workflowHandler) CancelRemoteJob(id operation.ID, _ string) error {
	h.mu.Lock()
	value, found := h.waiting[id]
	questionID := h.waitingQuestions[id]
	delete(h.waiting, id)
	delete(h.waitingQuestions, id)
	cancel := h.cancels[id]
	h.mu.Unlock()
	if questionID != "" {
		if q, err := h.questions.cancelOperation(h.session, questionID); err == nil {
			h.resolveQuestion(q)
		} else {
			return err
		}
	}
	if cancel != nil {
		cancel()
	}
	if found {
		step, err := operation.CancelRemoteJob(value)
		if err != nil {
			return err
		}
		h.publish(*step.Operation)
	}
	return nil
}
func (h *workflowHandler) pendingQuestions() []operation.ID {
	h.mu.Lock()
	defer h.mu.Unlock()
	ids := make([]operation.ID, 0, len(h.waiting))
	for id := range h.waiting {
		ids = append(ids, id)
	}
	return ids
}
func (h *workflowHandler) resolveQuestion(q questionRequest) {
	h.mu.Lock()
	waiting := make([]operation.Operation, 0)
	for id, key := range h.waitingQuestions {
		if key != q.ID {
			continue
		}
		if value, found := h.waiting[id]; found {
			waiting = append(waiting, value)
			delete(h.waiting, id)
			delete(h.waitingQuestions, id)
		}
	}
	h.mu.Unlock()
	for _, value := range waiting {
		state, err := operation.DecodeRemoteJobState(value)
		if err != nil {
			continue
		}
		state.TerminalResult = questionText(q)
		step, err := operation.UpdateRemoteJob(value, state, operation.StatusCompleted)
		if q.State == "cancelled" {
			step, err = operation.CancelRemoteJob(value)
		}
		if err == nil {
			h.publish(*step.Operation)
		}
	}
}

type searchMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}
type searchResult struct {
	Matches   []searchMatch `json:"matches"`
	Truncated bool          `json:"truncated"`
	Skipped   int           `json:"skipped"`
}

func searchProject(ctx context.Context, root string, p *contextPreferences, query string) (searchResult, error) {
	result := searchResult{Matches: []searchMatch{}}
	if strings.TrimSpace(query) == "" || len(query) > 500 {
		return result, errors.New("invalid search query")
	}
	output, err := exec.CommandContext(ctx, "git", "-c", "safe.directory="+root, "-C", root, "ls-files", "-co", "--exclude-standard", "-z").Output()
	var names []string
	if err == nil {
		names = strings.Split(string(output), "\x00")
	} else {
		err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if walkErr != nil {
				result.Skipped++
				return nil
			}
			rel, _ := filepath.Rel(root, path)
			if rel == "." {
				return nil
			}
			if p.excludes(rel) {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if !entry.IsDir() {
				names = append(names, rel)
			}
			if len(names) >= 10000 {
				result.Truncated = true
				return filepath.SkipAll
			}
			return nil
		})
		if err != nil {
			return result, err
		}
	}
	seen := make(map[string]bool)
	query = strings.ToLower(query)
	for index, name := range names {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if index >= 10000 {
			result.Truncated = true
			break
		}
		if name == "" || seen[name] || p.excludes(name) {
			continue
		}
		seen[name] = true
		path := filepath.Join(root, name)
		canonical, err := filepath.EvalSymlinks(path)
		if err != nil {
			result.Skipped++
			continue
		}
		rel, err := filepath.Rel(root, canonical)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || p.excludes(rel) {
			result.Skipped++
			continue
		}
		stat, err := os.Stat(canonical)
		if err != nil || !stat.Mode().IsRegular() || stat.Size() > 1024*1024 {
			result.Skipped++
			continue
		}
		bytes, err := os.ReadFile(canonical)
		if err != nil || strings.ContainsRune(string(bytes), 0) {
			result.Skipped++
			continue
		}
		for line, text := range strings.Split(string(bytes), "\n") {
			if strings.Contains(strings.ToLower(text), query) {
				if len(text) > 500 {
					text = text[:500]
				}
				result.Matches = append(result.Matches, searchMatch{Path: filepath.ToSlash(rel), Line: line + 1, Text: text})
				if len(result.Matches) >= 100 {
					result.Truncated = true
					return result, nil
				}
			}
		}
	}
	return result, nil
}
