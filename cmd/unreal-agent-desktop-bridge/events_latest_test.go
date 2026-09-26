package main

import (
	"bytes"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"testing"
)

func TestLatestEventsKeepsNewestWindow(t *testing.T) {
	log, err := newEventLog(t.TempDir(), &output{w: &bytes.Buffer{}})
	if err != nil {
		t.Fatal(err)
	}
	id := session.ID("11111111-1111-1111-1111-111111111111")
	for i := 0; i < 3105; i++ {
		if err := log.append(id, "fixture", map[string]int{"index": i}, 0); err != nil {
			t.Fatal(err)
		}
	}
	latest, err := log.latest(id, 3000)
	if err != nil {
		t.Fatal(err)
	}
	if len(latest) != 3000 || latest[0].Sequence != 106 || latest[2999].Sequence != 3105 {
		t.Fatalf("unexpected latest window: length %d", len(latest))
	}
	original, err := log.entries(id, 0, 10)
	if err != nil || len(original) != 10 || original[0].Sequence != 1 {
		t.Fatal("original history was not retained")
	}
}
