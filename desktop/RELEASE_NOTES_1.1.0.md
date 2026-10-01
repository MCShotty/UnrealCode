# UnrealCode 1.1.0

Background advice without holding up your task.

## Changes

- Jev advice and memory recall run behind accepted messages. The first response,
  steering, Stop and independent tools do not wait for them.
- Applicable advice arrives once at an existing model boundary. It cannot answer
  a question, approve an action, start idle work or reopen a completed task.
- Two app-wide decision slots serve project backends, with one active analysis
  and the latest pending snapshot per conversation. Cancellation holds capacity
  until the underlying operation settles.
- Synced input receipts protect accepted messages. Restart does not execute
  pending work; continuation remains explicit.
- The work feed shows advice status and attributed memory references. Native
  requests remain excluded from automatic advice and recall.
- Fixes cover stalled local workers, large image/prompt frames, stale backend
  callbacks, split Arabic text, invalid decision responses and unsafe redirects.

## Verification and limitations

The implementation passed 583 desktop tests, with six opt-in skips, plus Go
race/vet, helper tests, Docker compatibility and isolated packaged workflows.
See [implementation and acceptance](https://github.com/MCShotty/UnrealCode/blob/v1.1.0/docs/ASYNC_EXECUTION.md) for exact scope
and the local installer checksum. These are local results, not hosted release
attestation or fresh-machine acceptance.

The installer is unsigned. Save buffers, settle active tasks, close the app and
install manually. Published 1.0.4 and earlier releases remain unchanged.

New advisory records have verified canonical-prefix backups. Older binaries
cannot read that input kind. Before rollback, preserve the current profile and
session volumes; restore an earlier verified snapshot deliberately and retain
newer records separately. Never replay completed tools automatically.

Verify this release's installer against its SHA-256 manifest and
[GitHub build attestation](https://github.com/MCShotty/UnrealCode/blob/v1.1.0/desktop/VERIFY_RELEASE.md).
The local candidate checksum differs from hosted release bytes.

Real native Computer, populated Hindsight recovery, account-specific live
providers, a populated 1.0.4-profile upgrade, fresh-machine installation and
assistive-technology acceptance still need their own checks. Optional advice
does not guarantee correctness or grant permissions.
