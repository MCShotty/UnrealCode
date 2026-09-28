package main

import (
	"context"
	"io"
	"os"
	"testing"
	"time"
)

func TestClosingInputCancelsPendingDispatch(t *testing.T) {
	input, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- serveRequests(input, &output{w: io.Discard}, cancel, func(request) (any, error) {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		})
	}()
	if _, err := io.WriteString(writer, `{"v":1,"id":"pending","method":"test"}`+"\n"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("request was not dispatched")
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("bridge did not terminate after input closed")
	}
}
