package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"github.com/unreallabsai/unreal-agent/harness/session"
	"github.com/unreallabsai/unreal-agent/harness/sessionstore/localfile"
	"io"
	"os"
	"path/filepath"
	"uuid"
)

type advisoryBackup struct {
	done chan struct{}
	err  error
}
type advisoryBackupManifest struct {
	Version   int        `json:"version"`
	SessionID session.ID `json:"sessionId"`
	Bytes     int64      `json:"bytes"`
	SHA256    string     `json:"sha256"`
}

func (a *app) ensureAdvisoryBackup(ctx context.Context, id session.ID) error {
	a.backupMu.Lock()
	if a.advisoryBackups == nil {
		a.advisoryBackups = map[session.ID]*advisoryBackup{}
	}
	if prior := a.advisoryBackups[id]; prior != nil {
		a.backupMu.Unlock()
		select {
		case <-prior.done:
			return prior.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	job := &advisoryBackup{done: make(chan struct{})}
	a.advisoryBackups[id] = job
	a.backupMu.Unlock()
	job.err = a.backupAdvisorySession(ctx, id)
	a.backupMu.Lock()
	if job.err != nil {
		delete(a.advisoryBackups, id)
	}
	close(job.done)
	a.backupMu.Unlock()
	return job.err
}
func (a *app) backupAdvisorySession(ctx context.Context, id session.ID) error {
	if _, err := uuid.Parse(string(id)); err != nil {
		return err
	}
	dir := filepath.Join(a.root, "before-async-advisory-v1", string(id))
	path := filepath.Join(dir, string(id)+".session.jsonl")
	manifest := path + ".sha256.json"
	if data, err := os.ReadFile(manifest); err == nil {
		var value advisoryBackupManifest
		if json.Unmarshal(data, &value) != nil || value.Version != 1 || value.SessionID != id {
			return errors.New("Advisory backup manifest is incompatible")
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		hash := sha256.New()
		count, err := io.Copy(hash, f)
		if err != nil {
			return err
		}
		if count != value.Bytes || hex.EncodeToString(hash.Sum(nil)) != value.SHA256 {
			return errors.New("Advisory backup integrity check failed")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// Capture a committed prefix under the writer lock, then stream it outside
	// that lock. Appends cannot mutate that prefix. Steering and tool persistence
	// remain available while the backup is copied and validated.
	a.store.mu.Lock()
	f, err := os.Open(filepath.Join(a.root, "sessions", string(id)+".session.jsonl"))
	var size int64
	if err == nil {
		var info os.FileInfo
		info, err = f.Stat()
		if err == nil {
			size = info.Size()
		}
	}
	a.store.mu.Unlock()
	if err != nil {
		if f != nil {
			f.Close()
		}
		return err
	}
	defer f.Close()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	temporary, err := os.MkdirTemp(dir, ".pending-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	copyPath := filepath.Join(temporary, string(id)+".session.jsonl")
	out, err := os.OpenFile(copyPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	reader := io.LimitReader(f, size)
	writer := io.MultiWriter(out, hash)
	buffer := make([]byte, 64*1024)
	var copied int64
	for {
		if ctx.Err() != nil {
			err = ctx.Err()
			break
		}
		var n int
		n, err = reader.Read(buffer)
		if n > 0 {
			var written int
			written, err = writer.Write(buffer[:n])
			copied += int64(written)
			if err != nil {
				break
			}
		}
		if n == 0 {
			if err == io.EOF {
				err = nil
			}
			break
		}
	}
	if err == nil && copied != size {
		err = io.ErrUnexpectedEOF
	}
	if err == nil {
		err = out.Sync()
	}
	closed := out.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return err
	}
	// Parse the actual backup through the canonical store without model/tools.
	check, err := localfile.New(temporary)
	if err != nil {
		return err
	}
	if _, err = check.Resume(ctx, id); err != nil {
		return err
	}
	if err = os.Rename(copyPath, path); err != nil {
		return err
	}
	encoded, err := json.Marshal(advisoryBackupManifest{1, id, size, hex.EncodeToString(hash.Sum(nil))})
	if err != nil {
		return err
	}
	return atomicPrivateFile(manifest, encoded)
}
