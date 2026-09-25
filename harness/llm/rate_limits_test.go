package llm

import (
	"net/http"
	"testing"
)

func TestSafeRateLimitHeadersKeepsOnlyCounters(t *testing.T) {
	value := SafeRateLimitHeaders(http.Header{
		"X-Ratelimit-Limit-Tokens":           []string{"150000"},
		"X-Ratelimit-Remaining-Tokens":       []string{"120000"},
		"Anthropic-Ratelimit-Requests-Reset": []string{"2026-09-25T18:00:00Z"},
		"Authorization":                      []string{"Bearer private-token"},
		"Set-Cookie":                         []string{"private-cookie"},
	})
	if value["x-ratelimit-limit-tokens"] != "150000" || value["anthropic-ratelimit-requests-reset"] == "" || len(value) != 3 {
		t.Fatalf("unsafe or missing rate-limit projection: %#v", value)
	}
}
