package main

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"uuid"
)

type questionChoice struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Recommended bool   `json:"recommended,omitempty"`
}
type questionItem struct {
	ID      string           `json:"id"`
	Title   string           `json:"title"`
	Choices []questionChoice `json:"choices,omitempty"`
}
type questionAnswer struct {
	QuestionID string `json:"questionId"`
	ChoiceID   string `json:"choiceId,omitempty"`
	Text       string `json:"text,omitempty"`
}
type questionRequest struct {
	ID           string           `json:"id"`
	SessionID    string           `json:"sessionId"`
	WorkspaceID  string           `json:"workspaceId"`
	Revision     int              `json:"revision"`
	Mode         string           `json:"mode"`
	State        string           `json:"state"`
	Questions    []questionItem   `json:"questions"`
	Answers      []questionAnswer `json:"answers,omitempty"`
	SubmissionID string           `json:"submissionId,omitempty"`
	CreatedAt    string           `json:"createdAt"`
	UpdatedAt    string           `json:"updatedAt"`
	Legacy       bool             `json:"legacy,omitempty"`
}
type questionLedger struct {
	mu        sync.Mutex
	root      string
	events    *eventLog
	rows      map[session.ID]map[string]questionRequest
	delivered map[session.ID]map[string]bool
}

func (s *questionLedger) load(id session.ID) (map[string]questionRequest, error) {
	if s.rows == nil {
		s.rows = map[session.ID]map[string]questionRequest{}
	}
	if rows, ok := s.rows[id]; ok {
		return rows, nil
	}
	rows := map[string]questionRequest{}
	data, err := os.ReadFile(filepath.Join(s.root, string(id)+".json"))
	if err == nil {
		if len(data) > 16*1024*1024 {
			return nil, errors.New("Question history exceeds its safe limit")
		}
		if err = json.Unmarshal(data, &rows); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	} else {
		// Older questions are recovered from their persisted operation outcomes.
		{
			// Read once; repeated paged reads would rescan the complete log for
			// every page and stall large legacy conversations on first resume.
			s.events.mu.Lock()
			entries, err := s.events.readLocked(id)
			s.events.mu.Unlock()
			if err != nil {
				return nil, err
			}
			for _, event := range entries {
				if event.Event != "question.updated" && event.Event != "session.needs_input" && event.Event != "operation.update" {
					continue
				}
				var p map[string]any
				if json.Unmarshal(event.Payload, &p) != nil {
					continue
				}
				if event.Event == "question.updated" {
					var q questionRequest
					if json.Unmarshal(event.Payload, &q) == nil && q.ID != "" {
						rows[q.ID] = q
					}
				}
				if event.Event == "session.needs_input" && p["questionId"] == nil {
					key := str(p["operationId"])
					if key != "" {
						q := questionRequest{ID: key, SessionID: string(id), Revision: 1, Mode: "required", State: "pending", CreatedAt: event.RecordedAt.Format(time.RFC3339Nano), UpdatedAt: event.RecordedAt.Format(time.RFC3339Nano), Questions: []questionItem{{ID: "q1", Title: str(p["question"])}}}
						for i, c := range array(p["choices"]) {
							q.Questions[0].Choices = append(q.Questions[0].Choices, questionChoice{ID: fmt.Sprint(i + 1), Label: str(c)})
						}
						q.Legacy = true
						rows[key] = q
					}
				}
				if event.Event == "operation.update" {
					key := str(prop(p, "ID"))
					q, ok := rows[key]
					if ok && q.Legacy {
						state := str(prop(p, "Status"))
						if state == "completed" {
							q.State = "answered"
							q.Answers = []questionAnswer{{QuestionID: "q1", Text: str(prop(prop(p, "State"), "TerminalResult"))}}
						} else if state == "canceled" || state == "failed" {
							q.State = "cancelled"
						}
						q.UpdatedAt = event.RecordedAt.Format(time.RFC3339Nano)
						rows[key] = q
					}
				}
			}
		}
	}
	s.rows[id] = rows
	return rows, nil
}
func (s *questionLedger) put(id session.ID, q questionRequest) error {
	rows, err := s.load(id)
	if err != nil {
		return err
	}
	next := make(map[string]questionRequest, len(rows)+1)
	for k, v := range rows {
		next[k] = v
	}
	next[q.ID] = q
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if len(data) > 16*1024*1024 {
		return errors.New("Question history exceeds its safe limit")
	}
	if err = os.MkdirAll(s.root, 0700); err != nil {
		return err
	}
	path := filepath.Join(s.root, string(id)+".json")
	temp := path + "." + uuid.New().String() + ".tmp"
	file, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(temp)
	_, writeErr := file.Write(data)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		return err
	}
	s.rows[id] = next
	return s.events.append(id, "question.updated", q, 0)
}
func (s *questionLedger) list(id session.ID, workspace string) ([]questionRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return nil, err
	}
	result := make([]questionRequest, 0, len(rows))
	for _, q := range rows {
		if q.WorkspaceID == "" {
			q.WorkspaceID = workspace
		}
		result = append(result, q)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt < result[j].CreatedAt })
	return result, nil
}
func (s *questionLedger) blocked(id session.ID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return true
	}
	for _, q := range rows {
		if q.Mode == "required" && (q.State == "pending" || q.State == "answered" && q.SubmissionID != "" && !s.delivered[id][q.ID]) {
			return true
		}
	}
	return false
}
func (s *questionLedger) create(id session.ID, workspace, key string, args workflowArgs) (questionRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return questionRequest{}, err
	}
	if q, ok := rows[key]; ok {
		// Heal a crash between the durable card write and its event append.
		return q, s.events.append(id, "question.updated", q, 0)
	}
	pending := 0
	for _, q := range rows {
		if q.State == "pending" {
			pending++
		}
	}
	if pending >= 8 {
		return questionRequest{}, errors.New("Answer or dismiss existing questions before asking more")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	q := questionRequest{ID: key, SessionID: string(id), WorkspaceID: workspace, Revision: 1, Mode: args.Mode, State: "pending", Questions: args.Questions, CreatedAt: now, UpdatedAt: now}
	return q, s.put(id, q)
}
func (s *questionLedger) promote(id session.ID, key string) (questionRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return questionRequest{}, err
	}
	q, ok := rows[key]
	if !ok {
		return q, errors.New("Question does not belong to this conversation")
	}
	if q.State == "pending" && q.Mode != "required" {
		q.Mode = "required"
		q.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		err = s.put(id, q)
	}
	return q, err
}

type answerQuestionParams struct {
	SessionID    string           `json:"sessionId"`
	WorkspaceID  string           `json:"workspaceId"`
	ID           string           `json:"id"`
	Revision     int              `json:"revision"`
	SubmissionID string           `json:"submissionId"`
	Answers      []questionAnswer `json:"answers"`
	Resume       bool             `json:"resume"`
	Credential   credential       `json:"credential"`
}

func (s *questionLedger) answer(id session.ID, p answerQuestionParams) (questionRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return questionRequest{}, err
	}
	q, ok := rows[p.ID]
	if !ok || q.Revision != p.Revision || q.WorkspaceID != "" && q.WorkspaceID != p.WorkspaceID {
		return q, errors.New("Question changed or belongs to another workspace; refresh it")
	}
	if _, err = uuid.Parse(p.SubmissionID); err != nil {
		return q, errors.New("Invalid answer identity")
	}
	if len(p.Answers) != len(q.Questions) {
		return q, errors.New("Answer every question before submitting")
	}
	normalized := make([]questionAnswer, 0, len(p.Answers))
	for _, item := range q.Questions {
		var answer *questionAnswer
		for i := range p.Answers {
			if p.Answers[i].QuestionID == item.ID {
				if answer != nil {
					return q, errors.New("Duplicate question answer")
				}
				answer = &p.Answers[i]
			}
		}
		if answer == nil || len(answer.Text) > 8000 {
			return q, errors.New("Invalid or oversized answer")
		}
		value := *answer
		value.Text = strings.TrimSpace(value.Text)
		if value.ChoiceID != "" {
			found := false
			for _, choice := range item.Choices {
				if choice.ID == value.ChoiceID {
					found = true
				}
			}
			if !found {
				return q, errors.New("That choice is no longer available")
			}
		} else if value.Text == "" {
			return q, errors.New("Choose an option or write an answer")
		}
		normalized = append(normalized, value)
	}
	if q.State == "answered" {
		a, _ := json.Marshal(q.Answers)
		b, _ := json.Marshal(normalized)
		if q.SubmissionID == p.SubmissionID && string(a) == string(b) {
			return q, s.events.append(id, "question.updated", q, 0)
		}
		return q, errors.New("Question was already answered")
	}
	if q.State != "pending" {
		return q, errors.New("Question is no longer awaiting an answer")
	}
	q.State = "answered"
	q.WorkspaceID = p.WorkspaceID
	q.Answers = normalized
	q.SubmissionID = p.SubmissionID
	q.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return q, s.put(id, q)
}
func questionText(q questionRequest) string {
	var text strings.Builder
	fmt.Fprintf(&text, "Answer to question %s:\n", q.ID)
	for i, item := range q.Questions {
		fmt.Fprintf(&text, "%s\n", item.Title)
		for _, answer := range q.Answers {
			if answer.QuestionID != item.ID {
				continue
			}
			for _, choice := range item.Choices {
				if choice.ID == answer.ChoiceID {
					fmt.Fprintf(&text, "%s", choice.Label)
				}
			}
			if answer.Text != "" {
				fmt.Fprintf(&text, " %s", answer.Text)
			}
		}
		if i < len(q.Questions)-1 {
			text.WriteString("\n")
		}
	}
	return text.String()
}
func (s *questionLedger) cancel(id session.ID, key string, all bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return err
	}
	for _, q := range rows {
		if q.State != "pending" || !all && q.ID != key {
			continue
		}
		if !all && q.Mode == "required" {
			return errors.New("Stop the task to cancel a required question")
		}
		q.State = "cancelled"
		q.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err = s.put(id, q); err != nil {
			return err
		}
	}
	return nil
}
func (s *questionLedger) cancelOperation(id session.ID, key string) (questionRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.load(id)
	if err != nil {
		return questionRequest{}, err
	}
	q, ok := rows[key]
	if !ok {
		return q, errors.New("Unknown question")
	}
	if q.State != "pending" {
		return q, nil
	}
	q.State = "cancelled"
	q.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return q, s.put(id, q)
}
func (a *app) deliverAnswer(id session.ID, run *runningSession, q questionRequest) error {
	run.submitMu.Lock()
	defer run.submitMu.Unlock()
	key := inbox.ID(q.SubmissionID)
	if _, ok := run.accepted[key]; !ok {
		payload, _ := json.Marshal(map[string]any{"prompt": questionText(q), "questionResponse": map[string]any{"id": q.ID, "answers": q.Answers}})
		if err := run.inbox.Submit(a.ctx, inbox.Input{ID: key, Kind: inbox.InputExternal, Payload: payload, Deferred: q.Mode == "background"}); err != nil {
			return err
		}
		run.accepted[key] = struct{}{}
	}
	run.workflow.resolveQuestion(q)
	a.questions.mu.Lock()
	if a.questions.delivered == nil {
		a.questions.delivered = map[session.ID]map[string]bool{}
	}
	if a.questions.delivered[id] == nil {
		a.questions.delivered[id] = map[string]bool{}
	}
	a.questions.delivered[id][q.ID] = true
	a.questions.mu.Unlock()
	select {
	case run.modelReady <- struct{}{}:
	default:
	}
	return nil
}
func (a *app) questionRequest(req request) (any, error) {
	if req.Method == "question.answer" {
		p, err := decodeParams[answerQuestionParams](req.Params)
		if err != nil {
			return nil, err
		}
		id, err := requiredID(p.SessionID)
		if err != nil {
			return nil, err
		}
		config, err := a.loadConfig(id)
		if err != nil {
			return nil, err
		}
		if config.WorkspaceID != p.WorkspaceID {
			return nil, errors.New("Question workspace changed")
		}
		a.mu.Lock()
		run := a.running[id]
		a.mu.Unlock()
		if run == nil && !p.Resume {
			rows, readErr := a.questions.list(id, config.WorkspaceID)
			if readErr != nil {
				return nil, readErr
			}
			for _, q := range rows {
				if q.ID == p.ID && q.State == "answered" && q.SubmissionID == p.SubmissionID {
					return a.questions.answer(id, p)
				}
			}
			return nil, errors.New("Conversation is interrupted. Choose Answer and resume.")
		}
		q, err := a.questions.answer(id, p)
		if err != nil {
			return nil, err
		}
		if run == nil {
			run, err = a.start(id, p.Credential)
			if err != nil {
				return nil, err
			}
		}
		return q, a.deliverAnswer(id, run, q)
	}
	p, err := decodeParams[struct {
		SessionID string `json:"sessionId"`
		ID        string `json:"id,omitempty"`
	}](req.Params)
	if err != nil {
		return nil, err
	}
	id, err := requiredID(p.SessionID)
	if err != nil {
		return nil, err
	}
	config, err := a.loadConfig(id)
	if err != nil {
		return nil, err
	}
	if req.Method == "question.dismiss" {
		return nil, a.questions.cancel(id, p.ID, false)
	}
	rows, err := a.questions.list(id, config.WorkspaceID)
	a.mu.Lock()
	run := a.running[id]
	a.mu.Unlock()
	if run == nil {
		for i := range rows {
			if rows[i].State == "pending" {
				rows[i].State = "interrupted"
			}
		}
	}
	return rows, err
}

// Every answer is durable before delivery. Explicit session resumption replays
// only receipts absent from the canonical inbox input IDs.
func (a *app) replayAnswers(ctx context.Context, id session.ID, run *runningSession) error {
	rows, err := a.questions.list(id, "")
	if err != nil {
		return fmt.Errorf("Read saved question receipts: %w", err)
	}
	for _, q := range rows {
		if q.State == "answered" && q.SubmissionID != "" {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			run.submitMu.Lock()
			_, delivered := run.accepted[inbox.ID(q.SubmissionID)]
			run.submitMu.Unlock()
			if !delivered {
				if err := a.events.append(id, "question.updated", q, 0); err != nil {
					return err
				}
			}
			if err := a.deliverAnswer(id, run, q); err != nil {
				return err
			}
		}
	}
	return nil
}

func normalizeQuestions(args *workflowArgs) error {
	if args.Mode == "" {
		args.Mode = "required"
	}
	if args.Mode != "required" && args.Mode != "background" {
		return errors.New("Choose required or background question mode")
	}
	if len(args.Questions) == 0 && args.Question != "" {
		item := questionItem{ID: "q1", Title: args.Question}
		for i, c := range args.Choices {
			item.Choices = append(item.Choices, questionChoice{ID: fmt.Sprint(i + 1), Label: c})
		}
		args.Questions = []questionItem{item}
	}
	if len(args.Questions) < 1 || len(args.Questions) > 3 {
		return errors.New("Ask one to three questions")
	}
	ids := map[string]bool{}
	for i := range args.Questions {
		q := &args.Questions[i]
		if q.ID == "" {
			q.ID = fmt.Sprintf("q%d", i+1)
		}
		if len(q.ID) > 64 || ids[q.ID] || strings.TrimSpace(q.Title) == "" || len(q.Title) > 4000 || len(q.Choices) > 5 {
			return errors.New("Question needs a unique ID, bounded title and at most five choices")
		}
		ids[q.ID] = true
		options := map[string]bool{}
		for j := range q.Choices {
			c := &q.Choices[j]
			if c.ID == "" {
				c.ID = fmt.Sprint(j + 1)
			}
			if len(c.ID) > 64 || options[c.ID] || strings.TrimSpace(c.Label) == "" || len(c.Label) > 2000 || len(c.Description) > 2000 {
				return errors.New("Invalid question choice")
			}
			options[c.ID] = true
		}
	}
	return nil
}
func questionSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{"mode": map[string]any{"type": "string", "enum": []string{"required", "background"}}, "question": map[string]any{"type": "string"}, "choices": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "questions": map[string]any{"type": "array", "minItems": 1, "maxItems": 3, "items": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "choices": map[string]any{"type": "array", "maxItems": 5, "items": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "label": map[string]any{"type": "string"}, "description": map[string]any{"type": "string"}, "recommended": map[string]any{"type": "boolean"}}, "required": []string{"label"}}}}, "required": []string{"title"}}}}}
}
