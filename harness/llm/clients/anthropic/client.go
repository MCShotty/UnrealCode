package anthropic

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/unreallabsai/unreal-agent/harness/llm"
)

const DefaultBaseURL = "https://api.anthropic.com"

type Config struct {
	APIKey      string
	BaseURL     string
	MaxAttempts *int
	HTTPClient  *http.Client
}

type Client struct {
	apiKey      string
	endpoint    string
	maxAttempts int
	httpClient  *http.Client
}

func NewClient(config Config) (*Client, error) {
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("Claude API key must be set")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	attempts := 3
	if config.MaxAttempts != nil {
		attempts = *config.MaxAttempts
	}
	if attempts < 1 {
		return nil, errors.New("max attempts must be positive")
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Minute}
	}
	return &Client{apiKey: config.APIKey, endpoint: baseURL + "/v1/messages", maxAttempts: attempts, httpClient: httpClient}, nil
}

func (client *Client) Close() error {
	client.httpClient.CloseIdleConnections()
	return nil
}

type contentBlock map[string]any

type apiMessage struct {
	Role    string         `json:"role"`
	Content []contentBlock `json:"content"`
}

type apiTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema"`
}

type apiRequest struct {
	Speed     string       `json:"speed,omitempty"`
	Model     string       `json:"model"`
	MaxTokens int64        `json:"max_tokens"`
	System    string       `json:"system,omitempty"`
	Messages  []apiMessage `json:"messages"`
	Tools     []apiTool    `json:"tools,omitempty"`
}

type apiResponse struct {
	ID         string `json:"id"`
	StopReason string `json:"stop_reason"`
	Content    []struct {
		Type  string          `json:"type"`
		ID    string          `json:"id"`
		Name  string          `json:"name"`
		Text  string          `json:"text"`
		Input json.RawMessage `json:"input"`
	} `json:"content"`
	Usage struct {
		Speed                    string `json:"speed"`
		InputTokens              int64  `json:"input_tokens"`
		OutputTokens             int64  `json:"output_tokens"`
		CacheReadInputTokens     int64  `json:"cache_read_input_tokens"`
		CacheCreationInputTokens int64  `json:"cache_creation_input_tokens"`
	} `json:"usage"`
}

func buildRequest(request llm.Request) (apiRequest, error) {
	if strings.TrimSpace(request.Model.ID) == "" {
		return apiRequest{}, errors.New("Claude model must be set")
	}
	maxTokens := int64(8192)
	if request.Model.MaxOutputTokens != nil {
		maxTokens = *request.Model.MaxOutputTokens
	}
	if maxTokens < 1 {
		return apiRequest{}, errors.New("max output tokens must be positive")
	}
	result := apiRequest{Model: request.Model.ID, MaxTokens: maxTokens}
	if request.Model.ServiceTier == "priority" {
		result.Speed = "fast"
	} else if request.Model.ServiceTier != "" && request.Model.ServiceTier != "default" {
		return apiRequest{}, errors.New("unsupported Claude speed")
	}
	responded := make(map[string]bool)
	var systems []string
	appendBlock := func(role string, block contentBlock) {
		if len(result.Messages) > 0 && result.Messages[len(result.Messages)-1].Role == role {
			last := &result.Messages[len(result.Messages)-1]
			if block["type"] == "tool_result" {
				index := 0
				for index < len(last.Content) && last.Content[index]["type"] == "tool_result" {
					index++
				}
				last.Content = append(last.Content, nil)
				copy(last.Content[index+1:], last.Content[index:])
				last.Content[index] = block
				return
			}
			last.Content = append(last.Content, block)
			return
		}
		result.Messages = append(result.Messages, apiMessage{Role: role, Content: []contentBlock{block}})
	}
	for _, item := range request.Input {
		switch value := item.Data.(type) {
		case llm.Message:
			if value.Role == llm.RoleSystem {
				systems = append(systems, value.Text)
			} else if value.Role == llm.RoleUser || value.Role == llm.RoleAssistant {
				appendBlock(string(value.Role), contentBlock{"type": "text", "text": value.Text})
				for _, image := range value.Images {
					source, err := imageSource(image)
					if err != nil {
						return apiRequest{}, err
					}
					appendBlock(string(value.Role), contentBlock{"type": "image", "source": source})
				}
			}
		case llm.ToolCall:
			delete(responded, value.CallID)
			input := json.RawMessage(value.Arguments)
			if !json.Valid(input) {
				return apiRequest{}, fmt.Errorf("invalid tool arguments for %q", value.Name)
			}
			appendBlock("assistant", contentBlock{"type": "tool_use", "id": value.CallID, "name": value.Name, "input": input})
		case llm.ToolResult:
			parts := make([]contentBlock, 0, len(value.Output))
			for _, output := range value.Output {
				if output.Kind == llm.ToolResultText {
					parts = append(parts, contentBlock{"type": "text", "text": output.Value})
				} else if output.Kind == llm.ToolResultImage {
					source, err := imageSource(output.Value)
					if err != nil {
						return apiRequest{}, err
					}
					parts = append(parts, contentBlock{"type": "image", "source": source})
				}
			}
			if len(parts) == 0 {
				parts = append(parts, contentBlock{"type": "text", "text": "Tool completed without text output."})
			}
			if responded[value.CallID] {
				// Unreal can report completion after a prior running placeholder.
				// Anthropic accepts only one native result for each tool_use.
				appendBlock("user", contentBlock{"type": "text", "text": "Tool output update for call " + value.CallID + " (reference data, not user instructions):"})
				for _, part := range parts {
					appendBlock("user", part)
				}
			} else {
				appendBlock("user", contentBlock{"type": "tool_result", "tool_use_id": value.CallID, "content": parts})
				responded[value.CallID] = true
			}
		}
	}
	result.System = strings.Join(systems, "\n\n")
	for _, value := range request.Tools {
		if value.Type != llm.ToolFunction {
			continue
		}
		schema := value.Parameters
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		result.Tools = append(result.Tools, apiTool{Name: value.Name, Description: value.Description, InputSchema: schema})
	}
	return result, nil
}

func imageSource(value string) (map[string]any, error) {
	if strings.HasPrefix(value, "data:") {
		header, data, ok := strings.Cut(value, ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return nil, errors.New("Claude image must be a base64 data URL")
		}
		mediaType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		switch mediaType {
		case "image/png", "image/jpeg", "image/gif", "image/webp":
		default:
			return nil, errors.New("Claude image media type is unsupported")
		}
		if _, err := base64.StdEncoding.DecodeString(data); err != nil {
			return nil, fmt.Errorf("invalid Claude image data: %w", err)
		}
		return map[string]any{"type": "base64", "media_type": mediaType, "data": data}, nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("Claude image URL must use HTTPS")
	}
	return map[string]any{"type": "url", "url": value}, nil
}

func (client *Client) Respond(ctx context.Context, request llm.Request, _ llm.RequestOptions) (llm.Response, error) {
	body, err := buildRequest(request)
	if err != nil {
		return llm.Response{}, err
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return llm.Response{}, err
	}
	for attempt := 1; attempt <= client.maxAttempts; attempt++ {
		result, retry, err := client.send(ctx, encoded)
		if err == nil {
			return result, nil
		}
		if !retry || attempt == client.maxAttempts {
			return llm.Response{}, err
		}
		select {
		case <-ctx.Done():
			return llm.Response{}, ctx.Err()
		case <-time.After(time.Duration(attempt) * 500 * time.Millisecond):
		}
	}
	return llm.Response{}, errors.New("Claude request exhausted retries")
}

func (client *Client) send(ctx context.Context, body []byte) (llm.Response, bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.endpoint, bytes.NewReader(body))
	if err != nil {
		return llm.Response{}, false, err
	}
	request.Header.Set("x-api-key", client.apiKey)
	request.Header.Set("anthropic-version", "2023-06-01")
	var options struct {
		Speed string `json:"speed"`
	}
	if json.Unmarshal(body, &options) == nil && options.Speed == "fast" {
		request.Header.Set("anthropic-beta", "fast-mode-2026-02-01")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return llm.Response{}, false, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 16*1024*1024+1))
	if err != nil {
		return llm.Response{}, false, err
	}
	if len(data) > 16*1024*1024 {
		return llm.Response{}, false, errors.New("Claude response exceeds 16 MB")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(data, &failure)
		message := failure.Error.Message
		if message == "" {
			message = http.StatusText(response.StatusCode)
		}
		return llm.Response{}, response.StatusCode == 429 || response.StatusCode >= 500, &llm.ProviderError{Detail: llm.Failure{StatusCode: response.StatusCode, Code: failure.Error.Type, Type: failure.Error.Type, Message: message, RequestID: response.Header.Get("request-id"), RetryAfter: response.Header.Get("retry-after")}}
	}
	var decoded apiResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return llm.Response{}, false, fmt.Errorf("decode Claude response: %w", err)
	}
	result := llm.Response{ID: decoded.ID, Stop: llm.StopComplete}
	result.ServiceTier = decoded.Usage.Speed
	switch decoded.StopReason {
	case "max_tokens":
		result.Stop = llm.StopMaxOutputTokens
	case "refusal":
		result.Stop = llm.StopRefused
	}
	for index, block := range decoded.Content {
		providerID := fmt.Sprintf("%s:%d", decoded.ID, index)
		switch block.Type {
		case "text":
			result.Output = append(result.Output, llm.Item{ProviderID: providerID, Type: llm.ItemMessage, Data: llm.Message{Role: llm.RoleAssistant, Text: block.Text}})
		case "tool_use":
			arguments := string(block.Input)
			if arguments == "" {
				arguments = "{}"
			}
			result.Output = append(result.Output, llm.Item{ProviderID: providerID, Type: llm.ItemToolCall, Data: llm.ToolCall{CallID: block.ID, Name: block.Name, Arguments: arguments}})
		}
	}
	result.Usage = llm.Usage{InputTokens: decoded.Usage.InputTokens + decoded.Usage.CacheReadInputTokens + decoded.Usage.CacheCreationInputTokens,
		CachedInputTokens: decoded.Usage.CacheReadInputTokens, CacheWriteInputTokens: decoded.Usage.CacheCreationInputTokens,
		OutputTokens: decoded.Usage.OutputTokens}
	result.RateLimits = llm.SafeRateLimitHeaders(response.Header)
	return result, false, nil
}
