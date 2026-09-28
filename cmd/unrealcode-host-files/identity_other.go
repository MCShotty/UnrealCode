//go:build !windows

package main

import (
	"errors"
	"os"
	"syscall"
)

func rootIdentity(root *os.Root) (string, error) { return "", nil }
func singleLink(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if data, ok := info.Sys().(*syscall.Stat_t); ok && data.Nlink > 1 {
		return errors.New("Hard-linked project files are not supported")
	}
	return nil
}
func platformErrorCode(err error) string {
	if errors.Is(err, syscall.ENOTDIR) {
		return "ENOTDIR"
	}
	if errors.Is(err, syscall.ENOTEMPTY) {
		return "ENOTEMPTY"
	}
	return "CONFINED_FS"
}
