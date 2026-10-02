package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestAdvisoryRetriesOnlyTransientFailures(t *testing.T) {
	for _, status := range []int{401, 403, 422, 429, 529, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					w.Header().Set("X-Request-Id", "fixture-request")
					w.Header().Set("Retry-After", "0")
					w.WriteHeader(status)
					return
				}
				_, _ = w.Write([]byte(`{"model":"fixture","answers":{"q":{"type":"noul","noul":0.5}},"usage":{"input_tokens":1,"output_tokens":1}}`))
			}))
			defer server.Close()
			a, cancel, _, _ := testApp(t, t.TempDir(), false)
			defer cancel()
			a.decision.endpoint = server.URL
			batch := decisionBatch{State: "bounded evidence", Questions: map[string]decisionQuestion{"q": {Type: "noul", Instructions: "Does the evidence apply?"}}}
			_, _, err := a.preflight(context.Background(), decisionConfig{Engine: "jev", Model: "fixture", APIKey: "fixture"}, batch)
			if status == 401 || status == 403 || status == 422 {
				if err == nil || calls.Load() != 1 {
					t.Fatal("permanent denial retried")
				}
				issue := decisionIssue(err)
				if issue.HTTPStatus != status || issue.RequestID != "fixture-request" {
					t.Fatal("structured failure metadata lost")
				}
			} else if err != nil || calls.Load() != 2 {
				t.Fatalf("transient retry: %v calls=%d", err, calls.Load())
			}
		})
	}
}
func TestDecisionFailureDoesNotExposeReflectedCredential(t *testing.T) {
	response := &http.Response{StatusCode: 401, Header: http.Header{"X-Request-Id": []string{"fixture-secret"}}}
	err := decisionHTTPFailure(response, "fixture-secret")
	encoded, _ := json.Marshal(decisionIssue(err))
	if err.RequestID != "" || string(encoded) == "" {
		t.Fatal("credential reflection was not removed")
	}
}
func TestDecisionRedirectCannotForwardCredentials(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Add(1) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer origin.Close()
	runtime := newDecisionRuntime()
	runtime.endpoint = origin.URL
	batch := decisionBatch{State: "reference", Questions: map[string]decisionQuestion{"q": {Type: "noul", Instructions: "Does this apply?"}}}
	if _, err := runtime.evaluateConfigured(t.Context(), batch, decisionConfig{Engine: "jev", Model: "fixture", APIKey: "fixture"}); err == nil {
		t.Fatal("redirect accepted")
	}
	if forwarded.Load() != 0 {
		t.Fatal("decision credentials reached a redirected origin")
	}
}
