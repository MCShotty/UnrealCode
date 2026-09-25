package llm

import (
	"net/http"
	"strings"
)

// SafeRateLimitHeaders keeps only provider-documented, noncredential counters.
func SafeRateLimitHeaders(headers http.Header) map[string]string {
	allowed := []string{
		"x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests",
		"x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens",
		"anthropic-ratelimit-requests-limit", "anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-requests-reset",
		"anthropic-ratelimit-input-tokens-limit", "anthropic-ratelimit-input-tokens-remaining", "anthropic-ratelimit-input-tokens-reset",
		"anthropic-ratelimit-output-tokens-limit", "anthropic-ratelimit-output-tokens-remaining", "anthropic-ratelimit-output-tokens-reset",
	}
	result := make(map[string]string)
	for _, name := range allowed {
		value := strings.TrimSpace(headers.Get(name))
		if value != "" && len(value) <= 64 {
			result[name] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
