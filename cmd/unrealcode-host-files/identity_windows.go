package main

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"strconv"
	"strings"
)

func rootIdentity(root *os.Root) (string, error) {
	f, err := root.Open(".")
	if err != nil {
		return "", err
	}
	defer f.Close()
	var filesystem [64]uint16
	if err = windows.GetVolumeInformationByHandle(windows.Handle(f.Fd()), nil, 0, nil, nil, nil, &filesystem[0], uint32(len(filesystem))); err != nil {
		return "", err
	}
	// Node exposes a 64-bit inode. ReFS needs its full 128-bit file ID, so it
	// cannot participate in this cross-process identity contract safely yet.
	if strings.EqualFold(windows.UTF16ToString(filesystem[:]), "ReFS") {
		return "", errors.New("ReFS workspaces are not supported by confined file access yet. Use an NTFS project and app-data location.")
	}
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &info); err != nil {
		return "", err
	}
	return strconv.FormatUint(uint64(info.VolumeSerialNumber), 10) + ":" + strconv.FormatUint(uint64(info.FileIndexHigh)<<32|uint64(info.FileIndexLow), 10), nil
}
func singleLink(file *os.File) error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &info); err != nil {
		return err
	}
	if info.NumberOfLinks > 1 {
		return errors.New("Hard-linked project files are not supported")
	}
	return nil
}
func platformErrorCode(err error) string {
	if errors.Is(err, windows.ERROR_DIRECTORY) {
		return "ENOTDIR"
	}
	if errors.Is(err, windows.ERROR_DIR_NOT_EMPTY) {
		return "ENOTEMPTY"
	}
	return "CONFINED_FS"
}
