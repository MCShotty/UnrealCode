package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/json/jsontext"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/unreallabsai/unreal-agent/harness/llm"
	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/harness/tool"
)

const filePlan operation.RemoteJobPlanType = "unrealcode.files"
const fileLimit = 1024 * 1024

type fileEdit struct {
	Path             string  `json:"path"`
	ExpectedRevision string  `json:"expectedRevision"`
	Content          *string `json:"content"`
}
type fileArgs struct {
	Action    string     `json:"action"`
	Path      string     `json:"path"`
	StartLine int        `json:"startLine,omitempty"`
	Lines     int        `json:"lines,omitempty"`
	Edits     []fileEdit `json:"edits,omitempty"`
}
type fileTranslator struct{ action string }

func fileTools() []tool.ExtraStaticTool {
	text := func() map[string]any { return map[string]any{"type": "string"} }
	definitions := []struct {
		name, action, description string
		properties                map[string]any
		required                  []any
	}{
		{"ListFiles", "list", "List a project directory without running a shell. Paths are relative to the project.", map[string]any{"path": text()}, []any{"path"}},
		{"ReadFile", "read", "Read a bounded text file with line numbers and a SHA-256 revision for conflict-checked edits. Maximum file size 1 MiB. A missing file returns revision 'missing'.", map[string]any{"path": text(), "startLine": map[string]any{"type": "integer"}, "lines": map[string]any{"type": "integer"}}, []any{"path"}},
		{"ApplyPatch", "patch", "Apply structured file replacements after verifying every expectedRevision from ReadFile. Use 'missing' to create a file; content null deletes a file. At most 16 files; later edits conflict. Recovery copies are kept outside the project.", map[string]any{"edits": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"path": text(), "expectedRevision": text(), "content": map[string]any{"type": []string{"string", "null"}}}, "required": []any{"path", "expectedRevision", "content"}, "additionalProperties": false}}}, []any{"edits"}},
	}
	result := make([]tool.ExtraStaticTool, 0, len(definitions))
	for _, d := range definitions {
		result = append(result, tool.ExtraStaticTool{Definition: tool.Definition{Tool: llm.Tool{Type: llm.ToolFunction, Name: d.name, Description: d.description, Parameters: map[string]any{"type": "object", "properties": d.properties, "required": d.required, "additionalProperties": false}}}, Translator: fileTranslator{d.action}})
	}
	return result
}
func (t fileTranslator) Translate(ctx tool.Context, call llm.ToolCall) tool.CallStatus {
	var args fileArgs
	if len(call.Arguments) > 2*fileLimit || json.Unmarshal([]byte(call.Arguments), &args) != nil {
		return tool.CallStatus{Error: "Invalid file-tool arguments (maximum 2 MiB)"}
	}
	args.Action = t.action
	if err := validateFileArgs(args); err != nil {
		return tool.CallStatus{Error: err.Error()}
	}
	data, _ := json.Marshal(args)
	spec, err := operation.NewRemoteJobSpec(operation.RemoteJobPlan{Type: filePlan, Version: 1, Data: jsontext.Value(data)})
	if err != nil {
		return tool.CallStatus{Error: err.Error()}
	}
	spec.MaxOutputLength = operation.MaxOutputLength
	return tool.CallStatus{WaitingFor: []operation.ID{ctx.Submit(spec)}}
}
func (t fileTranslator) TranslateResult(id string, status tool.CallStatus, values []operation.Operation) (llm.ToolResult, error) {
	return (decisionToolTranslator{}).TranslateResult(id, status, values)
}

func filePath(path string, directory bool) error {
	if directory && (path == "" || path == ".") {
		return nil
	}
	if !filepath.IsLocal(path) || strings.ContainsAny(path, "\\:\x00") {
		return errors.New("Use a relative project path")
	}
	for _, part := range strings.Split(path, "/") {
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		reserved := base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || (len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9')
		if strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT") {
			suffix := base[3:]
			if utf8.RuneCountInString(suffix) == 1 && strings.ContainsAny(suffix, "123456789¹²³") {
				reserved = true
			}
		}
		if reserved || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return errors.New("Ambiguous Windows filename is not supported")
		}
		if part == "" || part == "." || part == ".." || strings.EqualFold(part, ".git") {
			return errors.New("Invalid project path or protected Git metadata")
		}
	}
	return nil
}
func validateFileArgs(args fileArgs) error {
	switch args.Action {
	case "list":
		return filePath(args.Path, true)
	case "read":
		if args.StartLine < 0 || args.Lines < 0 || args.Lines > 2000 {
			return errors.New("Read at most 2000 lines from a nonnegative starting line")
		}
		return filePath(args.Path, false)
	case "patch":
		if len(args.Edits) == 0 || len(args.Edits) > 16 {
			return errors.New("ApplyPatch requires 1 to 16 edits")
		}
		known := map[string]bool{}
		for _, edit := range args.Edits {
			if err := filePath(edit.Path, false); err != nil {
				return err
			}
			key := strings.ToLower(edit.Path)
			if known[key] {
				return errors.New("Duplicate edit path")
			}
			known[key] = true
			if edit.ExpectedRevision != "missing" {
				b, err := hex.DecodeString(edit.ExpectedRevision)
				if err != nil || len(b) != 32 {
					return errors.New("Expected revision must be a SHA-256 digest or 'missing'")
				}
			}
			if edit.Content != nil && (len(*edit.Content) > fileLimit || strings.ContainsRune(*edit.Content, 0) || !utf8.ValidString(*edit.Content)) {
				return errors.New("Replacement must be UTF-8 text below 1 MiB")
			}
		}
		return nil
	default:
		return errors.New("Unsupported file action")
	}
}
func revision(bytes []byte) string {
	value := sha256.Sum256(bytes)
	return hex.EncodeToString(value[:])
}

type fileLocks struct {
	mu    sync.Mutex
	paths map[string]*sync.Mutex
}

func (l *fileLocks) lock(paths []string) func() {
	keys := append([]string(nil), paths...)
	for i := range keys {
		keys[i] = strings.ToLower(keys[i])
	}
	sort.Strings(keys)
	locks := make([]*sync.Mutex, 0, len(keys))
	l.mu.Lock()
	if l.paths == nil {
		l.paths = map[string]*sync.Mutex{}
	}
	for _, key := range keys {
		key = strings.ToLower(key)
		if l.paths[key] == nil {
			l.paths[key] = &sync.Mutex{}
		}
		locks = append(locks, l.paths[key])
	}
	l.mu.Unlock()
	for _, lock := range locks {
		lock.Lock()
	}
	return func() {
		for i := len(locks) - 1; i >= 0; i-- {
			locks[i].Unlock()
		}
	}
}

type capturedFile struct {
	Bytes  []byte      `json:"bytes"`
	Exists bool        `json:"exists"`
	Mode   os.FileMode `json:"mode"`
}

func captureFile(root *os.Root, path string) (capturedFile, error) {
	current := ""
	for _, part := range strings.Split(path, "/") {
		current = filepath.Join(current, part)
		info, err := root.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			return capturedFile{}, nil
		}
		if err != nil {
			return capturedFile{}, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return capturedFile{}, errors.New("Symbolic links cannot be edited")
		}
	}
	f, err := root.Open(path)
	if err != nil {
		return capturedFile{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return capturedFile{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > fileLimit {
		return capturedFile{}, errors.New("Only regular files up to 1 MiB are supported")
	}
	bytes, err := io.ReadAll(io.LimitReader(f, fileLimit+1))
	if err != nil {
		return capturedFile{}, err
	}
	if len(bytes) > fileLimit {
		return capturedFile{}, errors.New("File exceeds 1 MiB")
	}
	return capturedFile{bytes, true, info.Mode().Perm()}, nil
}
func fileRevision(value capturedFile) string {
	if !value.Exists {
		return "missing"
	}
	return revision(value.Bytes)
}
func writeCaptured(root *os.Root, path string, value capturedFile, nonce string) error {
	if !value.Exists {
		err := root.Remove(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := root.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	temp := path + ".unrealcode-" + nonce + ".tmp"
	f, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, value.Mode)
	if err != nil {
		return err
	}
	defer root.Remove(temp)
	_, err = f.Write(value.Bytes)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return root.Rename(temp, path)
}

type fileHandler struct {
	workers             sync.WaitGroup
	closed              bool
	ctx                 context.Context
	workspace, recovery string
	locks               *fileLocks
	updates             chan operation.Operation
	mu                  sync.Mutex
	cancels             map[operation.ID]context.CancelFunc
}

func newFileHandler(ctx context.Context, workspace, recovery string, locks *fileLocks) *fileHandler {
	return &fileHandler{ctx: ctx, workspace: workspace, recovery: recovery, locks: locks, updates: make(chan operation.Operation, 64), cancels: map[operation.ID]context.CancelFunc{}}
}
func (h *fileHandler) RemoteJobPlanType() operation.RemoteJobPlanType       { return filePlan }
func (h *fileHandler) RemoteJobPlanVersion() operation.RemoteJobPlanVersion { return 1 }
func (h *fileHandler) RemoteJobUpdates() <-chan operation.Operation         { return h.updates }
func (h *fileHandler) CancelRemoteJob(id operation.ID, _ string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if cancel := h.cancels[id]; cancel != nil {
		cancel()
	}
	return nil
}
func (h *fileHandler) AddRemoteJob(value operation.Operation) error {
	state, err := operation.DecodeRemoteJobState(value)
	if err != nil {
		return err
	}
	var args fileArgs
	if err = json.Unmarshal(state.Plan.Data, &args); err != nil {
		return err
	}
	if err = validateFileArgs(args); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(h.ctx)
	h.mu.Lock()
	if h.closed || h.ctx.Err() != nil {
		h.mu.Unlock()
		cancel()
		return context.Canceled
	}
	h.workers.Add(1)
	h.cancels[value.ID] = cancel
	h.mu.Unlock()
	go func() {
		defer h.workers.Done()
		defer func() { cancel(); h.mu.Lock(); delete(h.cancels, value.ID); h.mu.Unlock() }()
		result, runErr := h.execute(ctx, args, string(value.ID))
		var step operation.Step
		if runErr != nil {
			step, err = operation.FailRemoteJob(value, runErr)
		} else {
			data, _ := json.Marshal(result)
			state.TerminalResult = string(data)
			step, err = operation.UpdateRemoteJob(value, state, operation.StatusCompleted)
		}
		if err == nil {
			select {
			case h.updates <- *step.Operation:
			case <-h.ctx.Done():
			}
		}
	}()
	return nil
}

func (h *fileHandler) stop() {
	h.mu.Lock()
	h.closed = true
	for _, cancel := range h.cancels {
		cancel()
	}
	h.mu.Unlock()
	h.workers.Wait()
}
func (h *fileHandler) execute(ctx context.Context, args fileArgs, id string) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(h.workspace)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if args.Action == "list" {
		path := args.Path
		if path == "" {
			path = "."
		}
		f, err := root.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		entries, err := f.ReadDir(1000)
		if err != nil && err != io.EOF {
			return nil, err
		}
		result := []map[string]any{}
		for _, entry := range entries {
			if strings.EqualFold(entry.Name(), ".git") || entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			result = append(result, map[string]any{"name": entry.Name(), "directory": entry.IsDir()})
		}
		return map[string]any{"entries": result, "possiblyTruncated": len(entries) == 1000}, nil
	}
	if args.Action == "read" {
		value, err := captureFile(root, args.Path)
		if err != nil {
			return nil, err
		}
		if !utf8.Valid(value.Bytes) || strings.ContainsRune(string(value.Bytes), 0) {
			return nil, errors.New("Binary file; use another suitable tool")
		}
		lines := strings.Split(string(value.Bytes), "\n")
		start := args.StartLine
		if start < 1 {
			start = 1
		}
		count := args.Lines
		if count == 0 {
			count = 300
		}
		begin := min(start-1, len(lines))
		end := min(begin+count, len(lines))
		content := strings.Join(lines[begin:end], "\n")
		truncated := end < len(lines) || len(content) > 64*1024
		if len(content) > 64*1024 {
			content = content[:64*1024]
			for !utf8.ValidString(content) {
				content = content[:len(content)-1]
			}
		}
		return map[string]any{"path": args.Path, "revision": fileRevision(value), "startLine": begin + 1, "totalLines": len(lines), "content": content, "truncated": truncated}, nil
	}
	paths := make([]string, 0, len(args.Edits))
	for _, edit := range args.Edits {
		paths = append(paths, edit.Path)
	}
	unlock := h.locks.lock(paths)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	before := map[string]capturedFile{}
	after := map[string]capturedFile{}
	for _, edit := range args.Edits {
		value, err := captureFile(root, edit.Path)
		if err != nil {
			return nil, err
		}
		if fileRevision(value) != edit.ExpectedRevision {
			return nil, fmt.Errorf("Conflict: %s changed since it was read", edit.Path)
		}
		before[edit.Path] = value
		next := capturedFile{}
		if edit.Content != nil {
			mode := value.Mode
			if mode == 0 {
				mode = 0644
			}
			next = capturedFile{[]byte(*edit.Content), true, mode}
		}
		after[edit.Path] = next
	}
	if err := os.MkdirAll(h.recovery, 0700); err != nil {
		return nil, err
	}
	data, _ := json.Marshal(before)
	recovery := filepath.Join(h.recovery, id+".json")
	if err := os.WriteFile(recovery, data, 0600); err != nil {
		return nil, err
	}
	written := []string{}
	for _, edit := range args.Edits {
		current, err := captureFile(root, edit.Path)
		if err == nil && fileRevision(current) != fileRevision(before[edit.Path]) {
			err = errors.New("File changed while applying patch")
		}
		if err == nil {
			err = ctx.Err()
		}
		if err == nil {
			err = writeCaptured(root, edit.Path, after[edit.Path], id)
		}
		if err != nil {
			for i := len(written) - 1; i >= 0; i-- {
				path := written[i]
				current, readErr := captureFile(root, path)
				if readErr == nil && fileRevision(current) == fileRevision(after[path]) {
					_ = writeCaptured(root, path, before[path], id+"-recover")
				}
			}
			return nil, fmt.Errorf("Patch interrupted: %w; recovery retained at %s", err, recovery)
		}
		written = append(written, edit.Path)
	}
	return map[string]any{"changed": paths, "recoveryId": id}, nil
}
