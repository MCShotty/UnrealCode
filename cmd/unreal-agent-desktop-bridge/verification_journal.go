package main

import (
	"errors"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"os"
	"path/filepath"
)

func (a *app) recordVerificationStart(id session.ID, operationID string) error {
	directory := filepath.Join(a.root, "verification-journal", string(id))
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(directory, operationID), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(err) {
		return errors.New("This verification may already have run; review its recorded outcome and start a new run explicitly")
	}
	if err != nil {
		return err
	}
	return file.Close()
}
