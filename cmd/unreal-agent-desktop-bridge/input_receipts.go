package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/inbox"
	"github.com/unreallabsai/unreal-agent/harness/session"
)

// Only not-yet-journalled inputs live here. Canonical session history remains
// authoritative. Opening these files never starts execution; an explicit send
// or resume may recover them. Payloads use the same private state directory.
type inputReceipt struct {
	Version     int         `json:"version"`
	SessionID   session.ID  `json:"sessionId"`
	WorkspaceID string      `json:"workspaceId"`
	Sequence    uint64      `json:"sequence"`
	Input       inbox.Input `json:"input"`
	Hash        string      `json:"hash"`
}

func inputHash(value inbox.Input) string {
	data, _ := json.Marshal(value, json.Deterministic(true))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func (a *app) receiptDirectory(id session.ID) string {
	return filepath.Join(a.root, "accepted-inputs-v1", string(id))
}
func (a *app) completeInputReceipt(id session.ID, input inbox.Input) {
	if input.Kind != inbox.InputExternal {
		return
	}
	// Inputs created before receipts existed have no corresponding file.
	if _, err := uuid.Parse(string(input.ID)); err != nil {
		return
	}
	_ = os.Remove(filepath.Join(a.receiptDirectory(id), string(input.ID)+".json"))
}
func (a *app) acceptInputReceipt(id session.ID, workspace string, sequence uint64, input inbox.Input) error {
	if input.Kind != inbox.InputExternal {
		return errors.New("only external user input can be accepted")
	}
	if err := input.Validate(); err != nil {
		return err
	}
	if _, err := uuid.Parse(string(input.ID)); err != nil {
		return errors.New("invalid message identity")
	}
	dir := a.receiptDirectory(id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	pendingCount := 0
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".json" {
			pendingCount++
		}
	}
	if pendingCount >= 128 {
		return errors.New("Too many pending messages; wait for the coordinator or recover interrupted work")
	}
	value := inputReceipt{1, id, workspace, sequence, input, inputHash(input)}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, string(input.ID)+".json")
	if existing, err := os.ReadFile(path); err == nil {
		var prior inputReceipt
		if json.Unmarshal(existing, &prior) != nil || prior.Hash != value.Hash || prior.WorkspaceID != workspace {
			return errors.New("Message identity is already bound to different content or workspace")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return atomicPrivateFile(path, encoded)
}
func atomicPrivateFile(path string, data []byte) error {
	temporary := path + "." + uuid.New().String() + ".tmp"
	defer os.Remove(temporary)
	f, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closed := f.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
func (a *app) pendingInputReceipts(id session.ID, workspace string, seen map[inbox.ID]struct{}, highest ...*uint64) ([]inbox.Input, error) {
	dir := a.receiptDirectory(id)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var values []inputReceipt
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		if len(values) >= 128 {
			return nil, errors.New("Pending message recovery exceeds its bound")
		}
		path := filepath.Join(dir, entry.Name())
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() > 16*1024*1024 {
			return nil, errors.New("Invalid pending message receipt")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var value inputReceipt
		if err := json.Unmarshal(data, &value, json.RejectUnknownMembers(true)); err != nil {
			return nil, err
		}
		if value.Version != 1 || value.SessionID != id || value.WorkspaceID != workspace || value.Input.Kind != inbox.InputExternal || value.Sequence == 0 || value.Hash != inputHash(value.Input) || entry.Name() != string(value.Input.ID)+".json" || value.Input.Validate() != nil {
			return nil, fmt.Errorf("Pending message receipt %q is incompatible or belongs to another workspace", entry.Name())
		}
		if _, err := uuid.Parse(string(value.Input.ID)); err != nil {
			return nil, err
		}
		if len(highest) > 0 && value.Sequence > *highest[0] {
			*highest[0] = value.Sequence
		}
		if _, ok := seen[value.Input.ID]; ok {
			a.completeInputReceipt(id, value.Input)
			continue
		}
		values = append(values, value)
	}
	sort.Slice(values, func(i, j int) bool { return values[i].Sequence < values[j].Sequence })
	result := make([]inbox.Input, 0, len(values))
	for _, value := range values {
		result = append(result, value.Input)
	}
	return result, nil
}
