package main

import (
	"bufio"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"sync"
)

const protocolVersion = 1

type request struct {
	Version int            `json:"v"`
	ID      string         `json:"id"`
	Method  string         `json:"method"`
	Params  jsontext.Value `json:"params,omitzero"`
}

type reply struct {
	Version int    `json:"v"`
	ID      string `json:"id"`
	OK      bool   `json:"ok"`
	Result  any    `json:"result,omitzero"`
	Error   string `json:"error,omitzero"`
}

type event struct {
	Version        int            `json:"v"`
	Event          string         `json:"event"`
	SessionID      string         `json:"sessionId"`
	Sequence       uint64         `json:"seq"`
	SourceSequence uint64         `json:"sourceSequence,omitzero"`
	Payload        jsontext.Value `json:"payload"`
}

type output struct {
	mu sync.Mutex
	w  io.Writer
}

func (o *output) write(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	_, err = fmt.Fprintf(o.w, "%s\n", encoded)
	return err
}

func readRequests(r io.Reader, handle func(request)) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue // Bad input has no trustworthy correlation ID.
		}
		handle(req)
	}
	return scanner.Err()
}

func decodeParams[T any](raw jsontext.Value) (T, error) {
	var value T
	if len(raw) == 0 {
		return value, fmt.Errorf("missing params")
	}
	err := json.Unmarshal(raw, &value, json.RejectUnknownMembers(true))
	return value, err
}
