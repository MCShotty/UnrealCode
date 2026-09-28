//go:build linux

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// A session volume has one writer even when two desktop processes start
// separate containers for the same project. The kernel releases this lease
// after a crash; a stale lock file does not block recovery.
func acquireBridgeLease(stateDirectory string) (*os.File, error) {
	if err := os.MkdirAll(stateDirectory, 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(stateDirectory, ".desktop-bridge.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return nil, errors.New("another UnrealCode backend is using this session storage; close its project before reopening here")
		}
		return nil, fmt.Errorf("lock UnrealCode session storage: %w", err)
	}
	return file, nil
}
