package main

import (
	"testing"
	"uuid"
)

func TestLateFieldnoteSnapshotCannotReviveWithdrawnGuidance(t *testing.T) {
	note := uuid.New().String()
	authority := &fieldnoteAuthority{}
	if err := authority.configure([]fieldnoteRef{{ID: note, Revision: 2, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	_ = authority.configure([]fieldnoteRef{{ID: note, Revision: 1, Enabled: true}})
	if authority.valid([]fieldnoteRef{{ID: note, Revision: 1}}) {
		t.Fatal("late snapshot revived withdrawn guidance")
	}
}

func TestLateFieldnoteSnapshotCannotDropNewlyAddedGuidance(t *testing.T) {
	a, b := uuid.New().String(), uuid.New().String()
	authority := &fieldnoteAuthority{}
	old := []fieldnoteRef{{ID: a, Revision: 1, Enabled: true}}
	if err := authority.configure(old, 1); err != nil {
		t.Fatal(err)
	}
	if err := authority.configure(append(old, fieldnoteRef{ID: b, Revision: 1, Enabled: true}), 2); err != nil {
		t.Fatal(err)
	}
	if err := authority.configure(old, 1); err != nil {
		t.Fatal(err)
	}
	if !authority.valid([]fieldnoteRef{{ID: b, Revision: 1}}) {
		t.Fatal("late snapshot dropped new guidance")
	}
}
