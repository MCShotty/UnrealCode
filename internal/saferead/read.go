package saferead

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// RegularFile reads a bounded regular file without following links outside its
// containing directory. The size is checked both before and after opening,
// because project files may change while a session is running.
func RegularFile(path string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("invalid file size limit")
	}
	entry, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !entry.Mode().IsRegular() {
		return nil, fmt.Errorf("file %q is not a regular file", path)
	}
	if entry.Size() > maxBytes {
		return nil, fmt.Errorf("file %q exceeds size limit of %d bytes", path, maxBytes)
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.Open(filepath.Base(path))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() {
		return nil, fmt.Errorf("file %q is not a regular file", path)
	}
	if opened.Size() > maxBytes {
		return nil, fmt.Errorf("file %q exceeds size limit of %d bytes", path, maxBytes)
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("file %q exceeds size limit of %d bytes", path, maxBytes)
	}
	if int64(len(data)) != opened.Size() {
		return nil, fmt.Errorf("file %q changed while reading", path)
	}
	return data, nil
}
