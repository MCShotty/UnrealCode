package main

import (
	"encoding/json"
	"testing"
)

func TestDecisionAnswersRejectMalformedProbabilitiesAndUnknownCriteria(t *testing.T) {
	choice := decisionQuestion{Type: "choice", Criteria: map[string]any{"one": "First", "two": "Second"}}
	score := decisionQuestion{Type: "score", Criteria: []any{"Low", "High"}}
	for _, example := range []struct {
		name  string
		q     decisionQuestion
		raw   string
		valid bool
	}{
		{"zero noul", decisionQuestion{Type: "noul"}, `{"type":"noul","noul":0}`, true},
		{"missing noul", decisionQuestion{Type: "noul"}, `{"type":"noul"}`, false},
		{"out of range", decisionQuestion{Type: "noul"}, `{"type":"noul","noul":1.2}`, false},
		{"valid choice", choice, `{"type":"choice","choice":"one","confidence":0.1,"probabilities":{"one":0.6,"two":0.4}}`, true},
		{"unknown choice", choice, `{"type":"choice","choice":"invented","confidence":1,"probabilities":{"one":1,"two":0}}`, false},
		{"no distribution", choice, `{"type":"choice","choice":"one","confidence":1}`, false},
		{"contradictory choice", choice, `{"type":"choice","choice":"one","confidence":1,"probabilities":{"one":0.2,"two":0.8}}`, false},
		{"wrong sum", choice, `{"type":"choice","choice":"one","confidence":1,"probabilities":{"one":0.6,"two":0.6}}`, false},
		{"fractional score", score, `{"type":"score","score":0.3,"confidence":0.2,"legend":{"0":"Low","1":"High"},"probabilities":{"0":0.7,"1":0.3}}`, true},
		{"wrong weighted score", score, `{"type":"score","score":0.9,"confidence":0.2,"legend":{"0":"Low","1":"High"},"probabilities":{"0":0.7,"1":0.3}}`, false},
		{"array score", score, `{"type":"score","score":0.3,"confidence":0.2,"probabilities":[0.7,0.3]}`, false},
	} {
		t.Run(example.name, func(t *testing.T) {
			err := validateDecisionAnswer(json.RawMessage(example.raw), example.q)
			if (err == nil) != example.valid {
				t.Fatalf("valid=%v error=%v", example.valid, err)
			}
		})
	}
}
