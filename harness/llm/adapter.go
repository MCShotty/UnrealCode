package llm

import "context"

type RequestOptions struct {
	CacheKey string
	// OnTextDelta is transient presentation only. The terminal Response remains
	// authoritative, and callers must not treat a partial delta as completion.
	OnTextDelta func(TextDelta)
}

type TextDelta struct {
	Attempt     int
	OutputIndex int
	Text        string
	Reset       bool
}

type Adapter interface {
	Respond(context.Context, Request, RequestOptions) (Response, error)
}
