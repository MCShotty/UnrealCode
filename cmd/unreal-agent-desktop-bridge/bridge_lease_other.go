//go:build !linux

package main

import (
	"os"
	"path/filepath"
)

// The desktop backend ships in a Linux container. This keeps development
// builds on other hosts compiling without claiming a cross-platform lease.
func acquireBridgeLease(stateDirectory string) (*os.File, error) {
	if err := os.MkdirAll(stateDirectory, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(stateDirectory, ".desktop-bridge.lock"), os.O_CREATE|os.O_RDWR, 0o600)
}
