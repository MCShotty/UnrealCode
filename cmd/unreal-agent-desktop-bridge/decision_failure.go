package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type decisionHTTPError struct {
	Status     int
	RequestID  string
	RetryAfter time.Duration
}

func (e *decisionHTTPError) Error() string { return fmt.Sprintf("TypeSafe returned HTTP %d", e.Status) }
func (e *decisionHTTPError) transient() bool {
	return e.Status == 429 || e.Status == 529 || e.Status == 408 || e.Status >= 500 && e.Status <= 599
}

var errDecisionRedirect = errors.New("Decision service redirects are not allowed")

func decisionRetryDelay(err error, attempt int) (time.Duration, bool) {
	if errors.Is(err, errDecisionRedirect) {
		return 0, false
	}
	var remote *decisionHTTPError
	if errors.As(err, &remote) {
		if !remote.transient() {
			return 0, false
		}
		if remote.RetryAfter > 0 {
			return remote.RetryAfter, true
		}
		return 250 * time.Millisecond << attempt, true
	}
	var network net.Error
	if errors.As(err, &network) {
		return 250 * time.Millisecond << attempt, true
	}
	return 0, false
}
func decisionHTTPFailure(response *http.Response, secret string) *decisionHTTPError {
	id := strings.TrimSpace(response.Header.Get("X-Request-Id"))
	if len(id) > 128 || id == secret || !decisionEvidenceSafe(id) || strings.ContainsAny(id, "\r\n\t ") {
		id = ""
	}
	var delay time.Duration
	if seconds, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && seconds > 0 && seconds <= 86400 {
		delay = time.Duration(seconds) * time.Second
	} else if at, err := http.ParseTime(response.Header.Get("Retry-After")); err == nil {
		delay = max(0, time.Until(at))
	}
	return &decisionHTTPError{response.StatusCode, id, delay}
}

type advisoryIssue struct {
	Code         string `json:"code"`
	HTTPStatus   int    `json:"httpStatus,omitempty"`
	RequestID    string `json:"requestId,omitempty"`
	RetryAfterMS int64  `json:"retryAfterMs,omitempty"`
}

func decisionIssue(err error) advisoryIssue {
	issue := advisoryIssue{Code: "invalid_or_unavailable_response"}
	var remote *decisionHTTPError
	if errors.Is(err, context.DeadlineExceeded) {
		issue.Code = "timeout"
		return issue
	}
	if errors.Is(err, context.Canceled) {
		issue.Code = "cancelled"
		return issue
	}
	if errors.As(err, &remote) {
		issue.HTTPStatus = remote.Status
		issue.RequestID = remote.RequestID
		issue.RetryAfterMS = remote.RetryAfter.Milliseconds()
		switch remote.Status {
		case 401:
			issue.Code = "authentication"
		case 403, 404:
			issue.Code = "access_denied"
		case 422:
			issue.Code = "unsupported_request"
		case 429:
			issue.Code = "rate_limit"
		default:
			issue.Code = "transient"
		}
	}
	return issue
}
