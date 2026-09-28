package llm

import (
	"errors"
	"strings"
)

// Remove the exact in-memory credentials before persisting provider diagnostics.
func RedactFailure(response *Response, secrets ...string) {
	if response.Failure == nil {
		return
	}
	failure := *response.Failure
	for _, field := range []*string{&failure.Code, &failure.Message, &failure.Type, &failure.RequestID, &failure.RetryAfter} {
		for _, secret := range secrets {
			if secret != "" {
				*field = strings.ReplaceAll(*field, secret, "[redacted]")
			}
		}
		if len(*field) > 4000 {
			*field = (*field)[:4000]
		}
	}
	response.Failure = &failure
}

// ProviderError retains safe provider metadata without request headers or bodies.
type ProviderError struct{ Detail Failure }

func (e *ProviderError) Error() string            { return e.Detail.Code + ": " + e.Detail.Message }
func (e *ProviderError) ProviderFailure() Failure { return e.Detail }

// NormalizeFailure makes structured rejections durable even when transport
// adapters return them as errors. Cancellation and network errors stay errors.
func NormalizeFailure(response Response, err error) (Response, error) {
	var provider interface{ ProviderFailure() Failure }
	if errors.As(err, &provider) {
		failure := provider.ProviderFailure()
		response.Failure = &failure
		err = nil
	}
	if response.Stop == StopRefused && response.Failure == nil {
		response.Failure = &Failure{Code: "model_refusal", Message: "The provider declined this request. Review its response and revise the request if appropriate."}
	}
	return response, err
}
