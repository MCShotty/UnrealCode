package main

import (
	"github.com/unreallabsai/unreal-agent/harness/session"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
	"uuid"
)

func TestVerificationPermissionsOutputAndReplay(t *testing.T) {
	a, close, _, _ := testApp(t, t.TempDir(), false)
	defer close()
	a.workspace = t.TempDir()
	id := session.ID(uuid.New().String())
	if err := a.saveConfig(id, sessionConfig{Mode: "plan"}); err != nil {
		t.Fatal(err)
	}
	request := verificationParams{SessionID: string(id), ID: uuid.New().String(), Command: "printf 'verified'; exit 7", TimeoutMS: 5000}
	if _, err := a.verifyCommand(request); err == nil {
		t.Fatal("Plan verification executed")
	}
	if err := a.saveConfig(id, sessionConfig{Mode: "agent"}); err != nil {
		t.Fatal(err)
	}
	result, err := a.verifyCommand(request)
	if err != nil || result.Output != "verified" || result.ExitCode != 7 {
		t.Fatalf("wrong result: %+v %v", result, err)
	}
	if _, err := a.verifyCommand(request); err == nil || !strings.Contains(err.Error(), "already") {
		t.Fatal("verification replay executed")
	}
	if err := a.saveConfig(id, sessionConfig{Mode: "agent", DisallowedTools: []string{"Bash"}}); err != nil {
		t.Fatal(err)
	}
	request.ID = uuid.New().String()
	if _, err := a.verifyCommand(request); err == nil {
		t.Fatal("disabled Bash verification executed")
	}
}
func TestVerificationCancellationIsScopedAndStopsProcessGroup(t *testing.T) {
	a, close, _, _ := testApp(t, t.TempDir(), false)
	defer close()
	a.workspace = t.TempDir()
	id := session.ID(uuid.New().String())
	if err := a.saveConfig(id, sessionConfig{Mode: "ask"}); err != nil {
		t.Fatal(err)
	}
	request := verificationParams{SessionID: string(id), ID: uuid.New().String(), Command: "sleep 30 & echo $! > child.pid; wait", TimeoutMS: 60000}
	result := make(chan verificationResult, 1)
	failure := make(chan error, 1)
	go func() { value, err := a.verifyCommand(request); result <- value; failure <- err }()
	waitFor(t, func() bool { return a.verification.busy() })
	var childPID int
	waitFor(t, func() bool {
		value, err := os.ReadFile(filepath.Join(a.workspace, "child.pid"))
		if err != nil {
			return false
		}
		childPID, err = strconv.Atoi(strings.TrimSpace(string(value)))
		return err == nil && childPID > 0
	})
	if err := a.verification.cancel(session.ID(uuid.New().String()), request.ID); err == nil {
		t.Fatal("cross-session cancellation accepted")
	}
	idle, err := a.dispatch(requestForTest("project.idle"))
	if err != nil || idle != false {
		t.Fatal("verification was missing from project busy state")
	}
	if err := a.verification.cancel(id, request.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case value := <-result:
		if !value.Cancelled {
			t.Fatal("cancellation not recorded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("verification process group did not terminate")
	}
	if err := <-failure; err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return syscall.Kill(childPID, 0) == syscall.ESRCH })
}
func requestForTest(method string) request { return request{Version: protocolVersion, Method: method} }
