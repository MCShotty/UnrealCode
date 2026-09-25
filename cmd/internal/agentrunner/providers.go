package agentrunner

import (
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/anthropic"
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/chatcompatible"
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/fireworks"
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/ollama"
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/openai"
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/openaicodex"
	"github.com/unreallabsai/unreal-agent/harness/llm/clients/openrouter"
)

func DefaultProviders() []Provider {
	return []Provider{
		{
			Name:              "anthropic",
			BaseURL:           anthropic.DefaultBaseURL,
			DefaultModel:      "claude-sonnet-5",
			APIKeyEnvironment: "ANTHROPIC_API_KEY",
			NewClient: func(apiKey, baseURL string, maxAttempts int, _ func(string) string) (Client, error) {
				return anthropic.NewClient(anthropic.Config{APIKey: apiKey, BaseURL: baseURL, MaxAttempts: &maxAttempts})
			},
		},
		{
			Name:    "ollama",
			BaseURL: ollama.BaseURL,
			NewClient: func(_, baseURL string, maxAttempts int, _ func(string) string) (Client, error) {
				return ollama.NewClient(ollama.Config{BaseURL: baseURL, MaxAttempts: &maxAttempts})
			},
		},
		{
			Name: "openai-compatible",
			NewClient: func(apiKey, baseURL string, maxAttempts int, _ func(string) string) (Client, error) {
				return chatcompatible.NewClient(apiKey, baseURL, maxAttempts)
			},
		},
		{
			Name:              "openai",
			BaseURL:           "https://api.openai.com/v1",
			DefaultModel:      "gpt-6-astra",
			APIKeyEnvironment: "OPENAI_API_KEY",
			NewClient: func(apiKey, baseURL string, maxAttempts int, _ func(string) string) (Client, error) {
				return openai.NewClient(openai.Config{APIKey: apiKey, BaseURL: baseURL, MaxAttempts: &maxAttempts})
			},
		},
		{
			Name:    "openai-codex",
			BaseURL: openaicodex.BaseURL,
			NewClient: func(_, baseURL string, maxAttempts int, getenv func(string) string) (Client, error) {
				config, err := openaicodex.EnvironmentConfig(getenv)
				if err != nil {
					return nil, err
				}
				config.BaseURL, config.MaxAttempts = baseURL, &maxAttempts
				return openaicodex.NewClient(config)
			},
		},

		{
			Name:              "openrouter",
			BaseURL:           "https://openrouter.ai/api/v1",
			APIKeyEnvironment: "OPENROUTER_API_KEY",
			NewClient: func(apiKey, baseURL string, maxAttempts int, _ func(string) string) (Client, error) {
				return openrouter.NewClient(openrouter.Config{APIKey: apiKey, BaseURL: baseURL, MaxAttempts: &maxAttempts})
			},
		},
		{
			Name:              "fireworks",
			BaseURL:           "https://api.fireworks.ai/inference/v1",
			APIKeyEnvironment: "FIREWORKS_API_KEY",
			NewClient: func(apiKey, baseURL string, maxAttempts int, _ func(string) string) (Client, error) {
				return fireworks.NewClient(fireworks.Config{APIKey: apiKey, BaseURL: baseURL, MaxAttempts: &maxAttempts})
			},
		},
	}
}
