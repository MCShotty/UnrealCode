package llm

import (
	"context"
	"fmt"
	"testing"
)

func TestNormalizeProviderRejections(t *testing.T) {
	r, e := NormalizeFailure(Response{Stop: StopRefused, Output: []Item{{Type: ItemMessage, Data: Message{Text: "Declined"}}}, Usage: Usage{InputTokens: 4}}, nil)
	if e != nil || r.Failure == nil || r.Failure.Code != "model_refusal" || len(r.Output) != 1 || r.Usage.InputTokens != 4 {
		t.Fatal("refusal evidence lost")
	}
	r, e = NormalizeFailure(Response{}, fmt.Errorf("wrapped: %w", &ProviderError{Detail: Failure{Code: "permission_error", StatusCode: 403, RequestID: "req"}}))
	if e != nil || r.Failure.StatusCode != 403 || r.Failure.RequestID != "req" {
		t.Fatal("structured error lost")
	}
	_, e = NormalizeFailure(Response{}, context.Canceled)
	if e != context.Canceled {
		t.Fatal("cancellation converted")
	}
}
