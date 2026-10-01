package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type decisionQuestion struct {
	Type         string `json:"type"`
	Instructions any    `json:"instructions"`
	Criteria     any    `json:"criteria,omitempty"`
}

type decisionBatch struct {
	State      any                         `json:"state"`
	Questions  map[string]decisionQuestion `json:"questions"`
	SourceRefs []string                    `json:"sourceRefs,omitempty"`
}

type decisionConfig struct {
	Engine        string `json:"engine"`
	Model         string `json:"model"`
	APIKey        string `json:"apiKey"`
	GLiNEREnabled bool   `json:"glinerEnabled"`
}

type decisionResult struct {
	Engine     string                     `json:"engine"`
	Model      string                     `json:"model"`
	Answers    map[string]json.RawMessage `json:"answers"`
	Usage      any                        `json:"usage,omitempty"`
	DurationMs int64                      `json:"durationMs"`
	SourceRefs []string                   `json:"sourceRefs,omitempty"`
}

type decisionRuntime struct {
	mu         sync.RWMutex
	installMu  sync.Mutex
	config     decisionConfig
	generation uint64
	endpoint   string
	client     *http.Client
	laya       pythonWorker
	gliner     pythonWorker
}

func newDecisionRuntime() *decisionRuntime {
	return &decisionRuntime{generation: 1, endpoint: "https://api.typesafe.ai/v1/systemone", client: &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errDecisionRedirect
	}}}
}

func (runtime *decisionRuntime) configure(config decisionConfig) error {
	if config.Engine != "off" && config.Engine != "jev" && config.Engine != "laya" {
		return errors.New("unsupported decision engine")
	}
	if config.Engine == "jev" && config.Model == "" {
		config.Model = "jev-latest"
	}
	runtime.mu.Lock()
	if runtime.config != config {
		runtime.generation++
	}
	runtime.config = config
	runtime.mu.Unlock()
	return nil
}

func (runtime *decisionRuntime) status() map[string]any {
	runtime.mu.RLock()
	config := runtime.config
	runtime.mu.RUnlock()
	available := false
	message := "Choose a decision engine in Settings."
	switch config.Engine {
	case "jev":
		available = strings.TrimSpace(config.APIKey) != ""
		message = "TypeSafe key is available."
		if !available {
			message = "TYPESAFE_API_KEY is unavailable or this workspace has not allowed cloud decisions."
		}
	case "laya":
		available = fileExists("/state/laya-venv/.unrealcode-installed")
		message = "Laya is installed."
		if !available {
			message = "Install the optional Laya worker in Settings."
		}
	}
	return map[string]any{"engine": config.Engine, "available": available, "message": message, "glinerAvailable": fileExists("/state/gliner-venv/.unrealcode-installed")}
}

func (runtime *decisionRuntime) available() bool {
	return runtime.status()["available"] == true
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func validateDecisionBatch(batch decisionBatch) error {
	if batch.State == nil || len(batch.Questions) < 1 || len(batch.Questions) > 64 {
		return errors.New("decision batch needs state and 1 to 64 questions")
	}
	encoded, err := json.Marshal(batch)
	if err != nil || len(encoded) > 256*1024 {
		return errors.New("decision batch exceeds 256 KB or is invalid")
	}
	for name, question := range batch.Questions {
		if name == "" || question.Instructions == nil {
			return errors.New("decision question needs an ID and instructions")
		}
		switch question.Type {
		case "choice":
			values, ok := question.Criteria.(map[string]any)
			if !ok || len(values) < 2 || len(values) > 255 {
				return fmt.Errorf("choice question %q needs 2 to 255 criteria", name)
			}
		case "score":
			values, ok := question.Criteria.([]any)
			if !ok || len(values) < 2 || len(values) > 10 {
				return fmt.Errorf("score question %q needs 2 to 10 levels", name)
			}
		case "noul":
		default:
			return fmt.Errorf("unsupported decision type %q", question.Type)
		}
	}
	return nil
}

// Models sometimes supply prose as Noul criteria. TypeSafe only accepts an
// optional {true, false} object there, so keep that prose as question guidance.
func normalizeDecisionBatch(batch decisionBatch) decisionBatch {
	normalized := batch
	normalized.Questions = make(map[string]decisionQuestion, len(batch.Questions))
	for name, question := range batch.Questions {
		// Model tool calls often capitalize the primitive as it appears in the
		// description. TypeSafe's wire types are always lowercase.
		question.Type = strings.ToLower(strings.TrimSpace(question.Type))
		if question.Type == "noul" {
			if guidance, ok := question.Criteria.(string); ok {
				if strings.TrimSpace(guidance) != "" {
					question.Instructions = []any{question.Instructions, map[string]any{"guidance": guidance}}
				}
				question.Criteria = nil
			}
		}
		normalized.Questions[name] = question
	}
	return normalized
}

func (runtime *decisionRuntime) evaluate(ctx context.Context, batch decisionBatch) (decisionResult, error) {
	runtime.mu.RLock()
	config := runtime.config
	runtime.mu.RUnlock()
	return runtime.evaluateConfigured(ctx, batch, config)
}

func (runtime *decisionRuntime) evaluateConfigured(ctx context.Context, batch decisionBatch, config decisionConfig) (decisionResult, error) {
	batch = normalizeDecisionBatch(batch)
	if err := validateDecisionBatch(batch); err != nil {
		return decisionResult{}, err
	}
	started := time.Now()
	switch config.Engine {
	case "jev":
		if config.APIKey == "" {
			return decisionResult{}, errors.New("TypeSafe key or project cloud consent is unavailable")
		}
		payload, err := runtime.callJev(ctx, batch, config)
		if err != nil {
			return decisionResult{}, err
		}
		payload.Engine = "jev"
		payload.DurationMs = time.Since(started).Milliseconds()
		payload.SourceRefs = batch.SourceRefs
		return payload, nil
	case "laya":
		if !fileExists("/state/laya-venv/.unrealcode-installed") {
			return decisionResult{}, errors.New("Laya is not installed")
		}
		var payload struct {
			Model   string                     `json:"model"`
			Answers map[string]json.RawMessage `json:"answers"`
			Usage   any                        `json:"usage"`
		}
		if err := runtime.laya.call(ctx, "/state/laya-venv/bin/python", "evaluate", batch, &payload); err != nil {
			return decisionResult{}, err
		}
		return decisionResult{Engine: "laya", Model: payload.Model, Answers: payload.Answers, Usage: payload.Usage, DurationMs: time.Since(started).Milliseconds(), SourceRefs: batch.SourceRefs}, nil
	default:
		return decisionResult{}, errors.New("select Jev or Laya in Settings")
	}
}

func (runtime *decisionRuntime) callJev(ctx context.Context, batch decisionBatch, config decisionConfig) (decisionResult, error) {
	body, err := json.Marshal(map[string]any{"model": config.Model, "state": batch.State, "questions": batch.Questions})
	if err != nil {
		return decisionResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, runtime.endpoint, bytes.NewReader(body))
	if err != nil {
		return decisionResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+config.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := runtime.client.Do(request)
	if err != nil {
		return decisionResult{}, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil {
		return decisionResult{}, err
	}
	if len(data) > 2*1024*1024 {
		return decisionResult{}, errors.New("decision response exceeds 2 MB")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return decisionResult{}, decisionHTTPFailure(response, config.APIKey)
	}
	var decoded struct {
		Model   string                     `json:"model"`
		Answers map[string]json.RawMessage `json:"answers"`
		Usage   any                        `json:"usage"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return decisionResult{}, err
	}
	if len(decoded.Answers) != len(batch.Questions) {
		return decisionResult{}, errors.New("decision response omitted questions")
	}
	for name, question := range batch.Questions {
		if err := validateDecisionAnswer(decoded.Answers[name], question); err != nil {
			return decisionResult{}, fmt.Errorf("invalid answer for %q", name)
		}
	}
	return decisionResult{Model: decoded.Model, Answers: decoded.Answers, Usage: safeDecisionUsage(decoded.Usage)}, nil
}

func (runtime *decisionRuntime) extract(ctx context.Context, text string, labels []string) ([]map[string]any, error) {
	runtime.mu.RLock()
	enabled := runtime.config.GLiNEREnabled
	runtime.mu.RUnlock()
	if !enabled {
		return nil, errors.New("GLiNER is disabled in Settings")
	}
	if len(text) == 0 || len(text) > 100000 || len(labels) == 0 || len(labels) > 50 {
		return nil, errors.New("entity extraction needs text and 1 to 50 labels")
	}
	labelBytes := 0
	for _, label := range labels {
		labelBytes += len(label)
		if strings.TrimSpace(label) == "" || labelBytes > 10000 {
			return nil, errors.New("entity labels must be nonempty and below 10 KB")
		}
	}
	if !fileExists("/state/gliner-venv/.unrealcode-installed") {
		return nil, errors.New("GLiNER is not installed")
	}
	var results []map[string]any
	err := runtime.gliner.call(ctx, "/state/gliner-venv/bin/python", "extract", map[string]any{"text": text, "labels": labels}, &results)
	return results, err
}

func (runtime *decisionRuntime) install(ctx context.Context, engine string) error {
	runtime.installMu.Lock()
	defer runtime.installMu.Unlock()
	var version string
	switch engine {
	case "laya":
		version = "laya==0.3.20"
	case "gliner":
		version = "gliner==0.2.29"
	default:
		return errors.New("unsupported local engine")
	}
	venv := filepath.Join("/state", engine+"-venv")
	marker := filepath.Join(venv, ".unrealcode-installed")
	_ = os.Remove(marker)
	if err := exec.CommandContext(ctx, "python3", "-m", "venv", venv).Run(); err != nil {
		return fmt.Errorf("create %s environment: %w", engine, err)
	}
	python := filepath.Join(venv, "bin", "python")
	command := exec.CommandContext(ctx, python, "-m", "pip", "install", "--no-input", version)
	command.Env = append(os.Environ(), "HF_HOME=/state/model-cache", "PIP_DISABLE_PIP_VERSION_CHECK=1")
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install %s: %w: %s", engine, err, string(output[max(0, len(output)-2000):]))
	}
	probe := exec.CommandContext(ctx, python, "-I", "-c", "import "+engine)
	if output, err := probe.CombinedOutput(); err != nil {
		return fmt.Errorf("verify %s: %w: %s", engine, err, string(output[max(0, len(output)-1000):]))
	}
	return os.WriteFile(marker, []byte(version), 0o600)
}

type pythonWorker struct {
	gateOnce sync.Once
	gate     chan struct{}
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   *bufio.Reader
}

func (worker *pythonWorker) call(ctx context.Context, python, method string, payload any, result any) error {
	worker.gateOnce.Do(func() { worker.gate = make(chan struct{}, 1) })
	select {
	case worker.gate <- struct{}{}:
		defer func() { <-worker.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if worker.cmd == nil {
		cmd := exec.Command(python, "/usr/local/lib/unrealcode/decision_worker.py")
		cmd.Env = append(os.Environ(), "HF_HOME=/state/model-cache")
		stdin, err := cmd.StdinPipe()
		if err != nil {
			return err
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			return err
		}
		cmd.Stderr = io.Discard
		if err := cmd.Start(); err != nil {
			return err
		}
		worker.cmd, worker.stdin, worker.stdout = cmd, stdin, bufio.NewReader(stdout)
	}
	request, err := json.Marshal(map[string]any{"method": method, "payload": payload})
	if err != nil {
		return err
	}
	type outcome struct {
		data []byte
		err  error
	}
	done := make(chan outcome, 1)
	reader := worker.stdout
	writer := worker.stdin
	go func() {
		if _, err := writer.Write(append(request, '\n')); err != nil {
			done <- outcome{err: err}
			return
		}
		var data []byte
		for {
			chunk, err := reader.ReadSlice('\n')
			data = append(data, chunk...)
			if len(data) > 2*1024*1024 {
				done <- outcome{err: errors.New("Local decision response exceeds 2 MB")}
				return
			}
			if err != bufio.ErrBufferFull {
				done <- outcome{data, err}
				return
			}
		}
	}()
	select {
	case <-ctx.Done():
		worker.stop()
		<-done // Keep the gate until the actual I/O goroutine has settled.
		return ctx.Err()
	case received := <-done:
		if received.err != nil {
			worker.stop()
			return received.err
		}
		var envelope struct {
			OK     bool            `json:"ok"`
			Result json.RawMessage `json:"result"`
			Error  string          `json:"error"`
		}
		if err := json.Unmarshal(received.data, &envelope); err != nil {
			worker.stop()
			return err
		}
		if !envelope.OK {
			return errors.New(envelope.Error)
		}
		return json.Unmarshal(envelope.Result, result)
	}
}

func (worker *pythonWorker) stop() {
	if worker.cmd == nil {
		return
	}
	_ = worker.cmd.Process.Kill()
	_ = worker.cmd.Wait()
	worker.cmd, worker.stdin, worker.stdout = nil, nil, nil
}
