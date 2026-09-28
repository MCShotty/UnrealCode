// Host filesystem operations use directory handles, never a checked path that
// is later reopened by Node. This helper has no network or credential interface.
package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
)

const maxBytes = 20 * 1024 * 1024

type request struct {
	ID                  int     `json:"id"`
	Method              string  `json:"method"`
	Root                string  `json:"root"`
	Identity            string  `json:"identity"`
	Path                string  `json:"path"`
	Limit               int64   `json:"limit"`
	Data                []byte  `json:"data"`
	Expected            *string `json:"expected"`
	Mode                uint32  `json:"mode"`
	ReplaceDirectory    bool    `json:"replaceDirectory"`
	AllowGit            bool    `json:"allowGit"`
	Handle              string  `json:"handle"`
	DestinationRoot     string  `json:"destinationRoot"`
	DestinationIdentity string  `json:"destinationIdentity"`
	DestinationPath     string  `json:"destinationPath"`
}
type entry struct {
	Name      string `json:"name"`
	Directory bool   `json:"directory"`
	Size      int64  `json:"size"`
	Mode      uint32 `json:"mode"`
	Link      bool   `json:"link"`
	Regular   bool   `json:"regular"`
}
type result struct {
	Data    []byte  `json:"data,omitempty"`
	Mode    uint32  `json:"mode,omitempty"`
	Entries []entry `json:"entries,omitempty"`
	Handle  string  `json:"handle,omitempty"`
	Size    int64   `json:"size"`
	Digest  string  `json:"digest,omitempty"`
}
type failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type response struct {
	ID    int      `json:"id"`
	Value *result  `json:"value,omitempty"`
	Error *failure `json:"error,omitempty"`
}

func validPath(name string, empty bool, allowGit bool) error {
	if empty && name == "" {
		return nil
	}
	if name == "" || len(name) > 32768 || strings.Count(name, "/") > 255 || !filepath.IsLocal(name) || strings.ContainsAny(name, "\\:\x00") {
		return errors.New("Invalid confined file path")
	}
	for _, p := range strings.Split(name, "/") {
		if p == "" || p == "." || p == ".." || !allowGit && strings.EqualFold(p, ".git") || strings.HasSuffix(p, ".") || strings.HasSuffix(p, " ") {
			return errors.New("Invalid confined file path")
		}
	}
	return nil
}

// Every parent stays open until the operation ends. Comparing the opened
// identity rejects a link or directory swap between Lstat and OpenRoot.
func descend(parent *os.Root, part string, create bool) (*os.Root, error) {
	before, err := parent.Lstat(part)
	if errors.Is(err, fs.ErrNotExist) && create {
		if err = parent.Mkdir(part, 0755); err != nil && !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
		before, err = parent.Lstat(part)
	}
	if err != nil {
		return nil, err
	}
	if !before.IsDir() || before.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("Symbolic links, junctions and non-directory parents are not allowed")
	}
	child, err := parent.OpenRoot(part)
	if err != nil {
		return nil, err
	}
	actual, err := child.Stat(".")
	if err != nil || !os.SameFile(before, actual) {
		child.Close()
		return nil, errors.New("Directory changed while opening; retry")
	}
	return child, nil
}
func openParents(q request, create bool) ([]*os.Root, string, error) {
	if !filepath.IsAbs(q.Root) {
		return nil, "", errors.New("An absolute trusted root is required")
	}
	before, err := os.Lstat(q.Root)
	if err != nil {
		return nil, "", err
	}
	if !before.IsDir() || before.Mode()&os.ModeSymlink != 0 {
		return nil, "", errors.New("Trusted root is a link or not a directory")
	}
	root, err := os.OpenRoot(q.Root)
	if err != nil {
		return nil, "", err
	}
	roots := []*os.Root{root}
	fail := func(err error) ([]*os.Root, string, error) { closeRoots(roots); return nil, "", err }
	actual, err := root.Stat(".")
	if err != nil || !os.SameFile(before, actual) {
		return fail(errors.New("Trusted root changed while opening"))
	}
	id, err := rootIdentity(root)
	if err != nil {
		return fail(err)
	}
	if q.Identity != "" && q.Identity != id {
		return fail(errors.New("Trusted root identity changed; reopen the project"))
	}
	parts := strings.Split(q.Path, "/")
	for _, part := range parts[:len(parts)-1] {
		child, err := descend(roots[len(roots)-1], part, create)
		if err != nil {
			return fail(err)
		}
		roots = append(roots, child)
	}
	return roots, parts[len(parts)-1], nil
}
func closeRoots(roots []*os.Root) {
	for i := len(roots) - 1; i >= 0; i-- {
		roots[i].Close()
	}
}
func openRegular(root *os.Root, name string) (*os.File, fs.FileInfo, error) {
	before, err := root.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, nil, errors.New("Only regular files are supported; links are not allowed")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, nil, err
	}
	actual, err := file.Stat()
	if err != nil || !actual.Mode().IsRegular() || !os.SameFile(before, actual) {
		file.Close()
		return nil, nil, errors.New("File changed while opening; retry")
	}
	if err = singleLink(file); err != nil {
		file.Close()
		return nil, nil, err
	}
	return file, actual, nil
}
func read(root *os.Root, name string, limit int64) ([]byte, fs.FileInfo, error) {
	before, err := root.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, nil, errors.New("Only regular files within the size limit can be read; links are not allowed")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	if err = singleLink(file); err != nil {
		return nil, nil, err
	}
	actual, err := file.Stat()
	if err != nil {
		return nil, nil, err
	}
	if !actual.Mode().IsRegular() || !os.SameFile(before, actual) {
		return nil, nil, errors.New("File changed while opening; retry")
	}
	if actual.Size() > limit {
		return nil, nil, errors.New("File exceeds its size limit")
	}
	bytes, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(bytes)) > limit {
		return nil, nil, errors.New("File grew beyond its size limit")
	}
	after, err := file.Stat()
	if err != nil {
		return nil, nil, err
	}
	if after.Size() != actual.Size() || !after.ModTime().Equal(actual.ModTime()) {
		return nil, nil, errors.New("File changed while reading; retry")
	}
	return bytes, actual, nil
}
func revision(root *os.Root, name string) (string, error) {
	bytes, _, err := read(root, name, maxBytes)
	if errors.Is(err, fs.ErrNotExist) {
		return "missing", nil
	}
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:]), nil
}
func execute(q request) (result, error) {
	if strings.HasPrefix(q.Method, "stream.") && q.Handle != "" {
		return streamOperation(q)
	}
	if err := validPath(q.Path, q.Method == "list", q.AllowGit); err != nil {
		return result{}, err
	}
	if q.Method == "read" && (q.Limit < 1 || q.Limit > maxBytes) {
		return result{}, errors.New("Invalid file size limit")
	}
	if len(q.Data) > maxBytes {
		return result{}, errors.New("Replacement exceeds file size limit")
	}
	roots, name, err := openParents(q, q.Method == "write" || q.Method == "mkdirAll")
	if err != nil {
		return result{}, err
	}
	defer func() { closeRoots(roots) }()
	parent := roots[len(roots)-1]
	switch q.Method {
	case "mkdir", "mkdirAll":
		if q.Method == "mkdir" {
			return result{}, parent.Mkdir(name, 0700)
		}
		directory, err := descend(parent, name, true)
		if err == nil {
			directory.Close()
		}
		return result{}, err
	case "hash", "copy":
		return copyOrHash(q, parent, name)
	case "stream.openRead", "stream.openWrite":
		// The stream owns the actual file and parent handles until close, not a path.
		value, err := openStream(q, parent, name, roots)
		if err != nil {
			return result{}, err
		}
		roots = nil
		return value, nil
	case "read":
		data, info, err := read(parent, name, q.Limit)
		if err != nil {
			return result{}, err
		}
		return result{Data: data, Mode: 0100000 | uint32(info.Mode().Perm())}, nil
	case "list":
		directory := parent
		if name != "" {
			directory, err = descend(parent, name, false)
			if err != nil {
				return result{}, err
			}
			defer directory.Close()
		}
		file, err := directory.Open(".")
		if err != nil {
			return result{}, err
		}
		defer file.Close()
		entries, err := file.ReadDir(20001)
		if err != nil && !errors.Is(err, io.EOF) {
			return result{}, err
		}
		if len(entries) > 20000 {
			return result{}, errors.New("Directory exceeds entry limit")
		}
		values := []entry{}
		for _, item := range entries {
			info, err := item.Info()
			if err != nil {
				continue
			}
			values = append(values, entry{Name: item.Name(), Directory: info.IsDir(), Size: info.Size(), Mode: uint32(info.Mode().Perm()), Link: info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0, Regular: info.Mode().IsRegular()})
		}
		return result{Entries: values}, nil
	case "write", "delete":
		if info, err := parent.Lstat(name); err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return result{}, errors.New("Symbolic links and junctions are not modified")
			}
			if info.IsDir() {
				if q.Method != "write" || !q.ReplaceDirectory {
					return result{}, errors.New("Destination is a directory")
				}
				if q.Expected != nil && *q.Expected != "missing" {
					return result{}, errors.New("File changed on disk; destination is now a directory")
				}
				if err = parent.Remove(name); err != nil {
					return result{}, err
				}
			}
		} else if !errors.Is(err, fs.ErrNotExist) {
			return result{}, err
		}
		check := func() error {
			if q.Expected == nil {
				return nil
			}
			current, err := revision(parent, name)
			if err != nil {
				return err
			}
			if current != *q.Expected {
				return errors.New("File changed on disk; reload or compare before saving")
			}
			return nil
		}
		if err := check(); err != nil {
			return result{}, err
		}
		if q.Method == "delete" {
			return result{}, parent.Remove(name)
		}
		suffix := make([]byte, 16)
		if _, err = rand.Read(suffix); err != nil {
			return result{}, err
		}
		temporary := ".unrealcode-write-" + hex.EncodeToString(suffix)
		mode := fs.FileMode(q.Mode & 0777)
		if mode == 0 {
			mode = 0644
		}
		file, err := parent.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			return result{}, err
		}
		defer parent.Remove(temporary)
		_, writeErr := file.Write(q.Data)
		syncErr := file.Sync()
		closeErr := file.Close()
		if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
			return result{}, err
		}
		if err = check(); err != nil {
			return result{}, err
		}
		return result{}, parent.Rename(temporary, name)
	case "prune":
		// Release the child directory handle before removing that exact empty entry.
		for i := len(roots) - 1; i > 0; i-- {
			roots[i].Close()
			part := strings.Split(q.Path, "/")[i-1]
			if err = roots[i-1].Remove(part); err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					continue
				}
				if errors.Is(err, fs.ErrExist) || platformErrorCode(err) == "ENOTEMPTY" {
					return result{}, nil
				}
				return result{}, err
			}
		}
		return result{}, nil
	case "removeTree":
		return result{}, parent.RemoveAll(name)
	default:
		return result{}, errors.New("Unknown confined filesystem operation")
	}
}

func copyOrHash(q request, parent *os.Root, name string) (result, error) {
	source, info, err := openRegular(parent, name)
	if err != nil {
		return result{}, err
	}
	defer source.Close()
	if info.Size() > 50*1024*1024*1024 {
		return result{}, errors.New("Recovery file exceeds 50 GiB")
	}
	hash := sha256.New()
	var writer io.Writer = hash
	var target *os.File
	var dest *os.Root
	var leaf, temp string
	if q.Method == "copy" {
		if err = validPath(q.DestinationPath, false, true); err != nil {
			return result{}, err
		}
		destination := request{Root: q.DestinationRoot, Identity: q.DestinationIdentity, Path: q.DestinationPath}
		roots, name, err := openParents(destination, true)
		if err != nil {
			return result{}, err
		}
		defer closeRoots(roots)
		dest = roots[len(roots)-1]
		leaf = name
		if _, err = dest.Lstat(leaf); !errors.Is(err, fs.ErrNotExist) {
			return result{}, errors.New("Recovery destination already exists or is inaccessible")
		}
		suffix := make([]byte, 16)
		if _, err = rand.Read(suffix); err != nil {
			return result{}, err
		}
		temp = ".unrealcode-copy-" + hex.EncodeToString(suffix)
		target, err = dest.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return result{}, err
		}
		defer target.Close()
		defer dest.Remove(temp)
		writer = io.MultiWriter(hash, target)
	}
	copied, err := io.Copy(writer, io.LimitReader(source, info.Size()+1))
	if err != nil {
		return result{}, err
	}
	after, err := source.Stat()
	if err != nil || copied != info.Size() || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return result{}, errors.New("Recovery file changed while copying")
	}
	if target != nil {
		if err = target.Sync(); err != nil {
			return result{}, err
		}
		if err = target.Close(); err != nil {
			return result{}, err
		}
		if _, err = dest.Lstat(leaf); !errors.Is(err, fs.ErrNotExist) {
			return result{}, errors.New("Recovery destination changed while copying")
		}
		if err = dest.Rename(temp, leaf); err != nil {
			return result{}, err
		}
	}
	return result{Digest: hex.EncodeToString(hash.Sum(nil)), Size: copied}, nil
}

type streamFile struct {
	mu      sync.Mutex
	file    *os.File
	roots   []*os.Root
	before  fs.FileInfo
	written bool
	closed  bool
}

var streams sync.Map
var streamCount atomic.Int32

func openStream(q request, parent *os.Root, name string, roots []*os.Root) (result, error) {
	if streamCount.Add(1) > 64 {
		streamCount.Add(-1)
		return result{}, errors.New("Too many open recovery streams; close existing transfers")
	}
	accepted := false
	defer func() {
		if !accepted {
			streamCount.Add(-1)
		}
	}()
	var file *os.File
	var info fs.FileInfo
	var err error
	if q.Method == "stream.openRead" {
		file, info, err = openRegular(parent, name)
	} else {
		file, err = parent.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			info, err = file.Stat()
		}
	}
	if err != nil {
		if file != nil {
			file.Close()
		}
		return result{}, err
	}
	suffix := make([]byte, 16)
	if _, err = rand.Read(suffix); err != nil {
		file.Close()
		return result{}, err
	}
	id := hex.EncodeToString(suffix)
	streams.Store(id, &streamFile{file: file, roots: roots, before: info, written: q.Method == "stream.openWrite"})
	accepted = true
	return result{Handle: id, Size: info.Size()}, nil
}
func streamOperation(q request) (result, error) {
	value, ok := streams.Load(q.Handle)
	if !ok {
		return result{}, errors.New("File stream is closed")
	}
	file := value.(*streamFile)
	file.mu.Lock()
	defer file.mu.Unlock()
	if file.closed {
		return result{}, errors.New("File stream is closed")
	}
	switch q.Method {
	case "stream.read":
		if file.written || q.Limit < 1 || q.Limit > 1024*1024 {
			return result{}, errors.New("Invalid stream read")
		}
		bytes := make([]byte, q.Limit)
		n, err := file.file.Read(bytes)
		if err != nil && !errors.Is(err, io.EOF) {
			return result{}, err
		}
		return result{Data: bytes[:n]}, nil
	case "stream.write":
		if !file.written || len(q.Data) > 1024*1024 {
			return result{}, errors.New("Invalid stream write")
		}
		n, err := file.file.Write(q.Data)
		if err == nil && n != len(q.Data) {
			err = io.ErrShortWrite
		}
		return result{Size: int64(n)}, err
	case "stream.close":
		var check error
		if !file.written {
			after, err := file.file.Stat()
			if err != nil || after.Size() != file.before.Size() || !after.ModTime().Equal(file.before.ModTime()) {
				check = errors.New("Recovery file changed during transfer")
			}
		} else {
			check = file.file.Sync()
		}
		file.closed = true
		streams.Delete(q.Handle)
		streamCount.Add(-1)
		err := file.file.Close()
		closeRoots(file.roots)
		return result{}, errors.Join(check, err)
	default:
		return result{}, errors.New("Unsupported stream action")
	}
}
func errorCode(err error) string {
	if errors.Is(err, fs.ErrNotExist) {
		return "ENOENT"
	}
	if errors.Is(err, fs.ErrPermission) {
		return "EACCES"
	}
	if errors.Is(err, fs.ErrExist) {
		return "EEXIST"
	}
	return platformErrorCode(err)
}
func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 65536), 32*1024*1024)
	var mu sync.Mutex
	var pending sync.WaitGroup
	slots := make(chan struct{}, 8)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var q request
		if err := json.Unmarshal(scanner.Bytes(), &q); err != nil {
			fmt.Fprintln(os.Stderr, "Invalid filesystem request")
			return
		}
		slots <- struct{}{}
		pending.Add(1)
		go func() {
			defer pending.Done()
			defer func() { <-slots }()
			value, err := execute(q)
			r := response{ID: q.ID, Value: &value}
			if err != nil {
				r.Value = nil
				r.Error = &failure{errorCode(err), err.Error()}
			}
			mu.Lock()
			encoder.Encode(r)
			mu.Unlock()
		}()
	}
	pending.Wait()
}
