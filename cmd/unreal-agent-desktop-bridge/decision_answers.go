package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
)

// Validate the documented wire values, not just their type labels. Confidence
// is retained as evidence, never treated as an authorization threshold.
func validateDecisionAnswer(raw json.RawMessage, q decisionQuestion) error {
	var value struct {
		Type          string             `json:"type"`
		Noul          *float64           `json:"noul"`
		Choice        string             `json:"choice"`
		Score         *float64           `json:"score"`
		Confidence    *float64           `json:"confidence"`
		Probabilities map[string]float64 `json:"probabilities"`
		Legend        map[string]string  `json:"legend"`
	}
	if json.Unmarshal(raw, &value) != nil || value.Type != q.Type {
		return errors.New("invalid decision answer type")
	}
	unit := func(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1 }
	if q.Type == "noul" {
		if value.Noul == nil || !unit(*value.Noul) {
			return errors.New("invalid yes/no probability")
		}
		return nil
	}
	if value.Confidence == nil || !unit(*value.Confidence) {
		return errors.New("invalid decision confidence")
	}
	keys := map[string]struct{}{}
	switch q.Type {
	case "choice":
		for key := range q.Criteria.(map[string]any) {
			keys[key] = struct{}{}
		}
		if _, exists := keys[value.Choice]; !exists {
			return errors.New("decision selected an unknown criterion")
		}
	case "score":
		for index, criterion := range q.Criteria.([]any) {
			key := strconv.Itoa(index)
			keys[key] = struct{}{}
			if value.Legend[key] == "" {
				return errors.New("decision score omitted its legend")
			}
			if text, ok := criterion.(string); ok && value.Legend[key] != text {
				return errors.New("decision score changed its legend")
			}
		}
		if len(value.Legend) != len(keys) || value.Score == nil || *value.Score < 0 || *value.Score > float64(len(keys)-1) {
			return errors.New("invalid decision score")
		}
	default:
		return errors.New("unknown decision answer type")
	}
	if len(value.Probabilities) != len(keys) {
		return errors.New("decision omitted probabilities")
	}
	sum, weighted := 0.0, 0.0
	for key, n := range value.Probabilities {
		if _, ok := keys[key]; !ok || !unit(n) {
			return errors.New("invalid decision probability")
		}
		sum += n
		if q.Type == "choice" && n > value.Probabilities[value.Choice]+1e-9 {
			return errors.New("decision choice does not match its probabilities")
		}
		if q.Type == "score" {
			index, _ := strconv.Atoi(key)
			weighted += float64(index) * n
		}
	}
	if math.Abs(sum-1) > 1e-3 {
		return errors.New("decision probabilities do not sum to one")
	}
	if q.Type == "score" && math.Abs(weighted-*value.Score) > 1e-3 {
		return fmt.Errorf("decision score does not match its probabilities")
	}
	return nil
}

func safeDecisionUsage(value any) any {
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(data, &raw) != nil {
		return nil
	}
	usage := map[string]int64{}
	for _, key := range []string{"input_tokens", "output_tokens"} {
		if data, ok := raw[key]; ok {
			var count int64
			if json.Unmarshal(data, &count) == nil && count >= 0 {
				usage[key] = count
			}
		}
	}
	if len(usage) == 0 {
		return nil
	}
	return usage
}
