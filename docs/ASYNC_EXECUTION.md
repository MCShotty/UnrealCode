# UnrealCode 1.1.0 asynchronous execution candidate

This work is local on `codex/async-execution`, based on the published 1.0.4
source and its documentation update. The owner named this candidate 1.1.0.
On 2026-10-02 the owner authorized merging and publishing it. Local acceptance
below precedes hosted verification; earlier published tags and installers are
preserved.

## Behavior

- Accept user input into a private, synced receipt before acknowledging it.
  The coordinator consumes the receipt into canonical history. Restart reads
  receipts without executing them. Explicit resume recovers unfinished inputs.
- Decision advice runs behind the accepted message. The first response, live
  steering, independent tools and Stop do not wait for Jev or Git evidence.
- Keep one active analysis per conversation, its latest pending request, and
  two app-wide decision leases across project backends. Cancelled analysis
  retains its lease until actual settlement.
- Deliver applicable advice once at an already-triggered model boundary.
  Advice is reference data, never a user answer, approval or execution control.
  It does not wake idle work, count as a tool, or reopen a completed task.
- Bind advice to project, workspace, session run, source input, request
  generation, decision/consent generation and context revision. Reject stale
  results after steering, stop, ownership changes, withdrawal or configuration
  changes. Approved plan content changes invalidate pending advice; progress
  updates do not rewrite plan content.
- Memory recall also runs after acceptance. Preserve authored Fieldnotes in
  the initial receipt. Late memory references and relevant retained Fieldnotes
  are bounded, attributed, visible in the work feed and checked for withdrawal.
  Native-content requests do not enter automatic recall.
- The observer remains separate. Three-second timeline polling and its
  two-slot memory pool are unchanged. Advice/control records and text previews
  do not create observer requests.

## Contracts and recovery

`async_advisory_v1` negotiates the new bridge behavior. The renderer receives
typed advice status through the existing event API. An older backend disables
decision calls and explains that rebuilding is required. It cannot fall back to
the old blocking preflight. Manual memory browsing remains available.

The new canonical input kind is `advisory`, with a versioned envelope. Delivered
advice replays as historical reference data. Pending advice is never restored
as a job. Durable status heads reconstruct interruption after restart; the
canonical delivered record takes precedence over an unfinished status flush.
Unknown versions remain untouched.

Before adding this kind, copy and parse a committed canonical prefix into
`before-async-advisory-v1/<session>/`, with a SHA-256 manifest. Copying occurs
outside the store writer lock. Failure skips advice while coding continues.
Existing metadata is not rewritten or historically reanalysed. SQLite retains
one writer and two readers, and indexes the new events using its existing path.

For rollback, stop the app and preserve a complete current profile/volume copy
first. An older binary rejects an unfamiliar input kind. A verified prior
session snapshot can be restored deliberately, alongside its matching metadata.
The backup is an earlier prefix and cannot represent later completed actions.
Keep those newer records separately and review them before any continuation.
Never roll back by deleting conversations or automatically rerunning tools.

## Decision validation

Keep the configured engine, model, source references, probabilities and measured
usage. Validate Choice, Noul and Score answers against the
[TypeSafe wire contract](https://docs.typesafe.ai/api), including score legends
and distributions. Credentials stay out of receipts and diagnostics. Reject
HTTP redirects. Permanent denials do not retry. Transient responses have at
most three attempts within the fifteen-second advisory deadline, respecting
Retry-After. No alternate engine is selected automatically.

Optional Git verification compares changes since its background baseline was
captured. It does not prove that all changes during a task were captured or
that tests passed. Local worker lock admission, stdin writes and output reads
are cancellable. Output is bounded to two MiB.

## Acceptance tracking

Confirmed before/fixed reproductions:

| Defect | Reproduction |
| --- | --- |
| Jev preflight blocks accepted sends | Hold its response; the old source cannot acknowledge a send. |
| Local worker lock ignores cancellation | Hold a worker; a cancelled second request cannot enter its lock. |
| Local worker stdin blocks cancellation | A child does not read a large request. |
| Valid attachments disconnect the bridge | Eight MiB of image strings plus a prompt exceed the old frame bound. |

Current focused checks cover durable receipts, exact ownership, duplicate input,
safe boundaries, real required questions followed by provider failure/retry,
backup integrity, bounded attributed recall, cancellation and global leases.
The implementation checks passed before assigning the 1.1.0 version:

| Check | Result |
| --- | --- |
| TypeScript | Both renderer and main/preload configurations pass. |
| Desktop regressions | 583 passed, six opt-in skips, no failures, 103 suites. |
| Go | Canonical `cmd`, `harness` and `internal` race tests and vet pass using pinned Go 1.27.1 in Docker with an init process. |
| Decision helper | Three Python tests pass; stalled-worker cancellation passes in Go. |
| Docker | Fresh source image builds; bundled bridge and adapter compatibility checks pass. |
| Packaged coding | Actual Docker fixture provider, approvals, dirty-file snapshot, Fieldnote receipts, integration, archive/restore and Plan mode pass. |
| Packaged regressions | Work activity, reliability, teams, documents, browser/Git and composer controls pass. |
| UI/motion | Four themes, two densities and 100/150/200% scaling pass across the existing 24-case matrix. No overflow; keyboard, narrow overlays, reduced motion and motion checks pass. |
| Credentials/notices | 1,515 locations scanned, 223 packaged dependencies reviewed, seven configured credential values compared privately, no credential hits. Notice generation reviews 233 npm packages and 35 helper dependency/runtime entries. |
| Preservation | Protected demo SHA-256 is unchanged. At local acceptance, no commits, pushes, tags or published assets had changed. |

These UI runs were offscreen with disposable profiles. They do not establish
visible desktop-2 or assistive-technology acceptance. The matrix includes an
actual 1.0.3 worker-profile upgrade; a newly populated 1.0.4 profile and a live
Hindsight bank still need their own upgrade/recovery acceptance.

Local 1.1.0 installer:
`desktop/dist-async-execution/UnrealCode-Setup-1.1.0.exe`, 225,395,718 bytes,
`NotSigned`.
SHA-256: `5C58A46ACDCDC1A00245BD04750ABA989CAEF1BCEB9155E8BDEE6922D6BD9068`.
This is a local candidate, not a published release or hosted attestation.

After the version change on 2026-10-02, both TypeScript configurations, the
Windows build and packaged reliability smoke passed. Installer resources,
application resources and the packaged `package.json` report 1.1.0. The payload
audit scanned 1,516 locations, reviewed 223 dependencies and found no credential
hits. The smoke used an isolated offscreen profile. The full implementation
suites above were not rerun for the version-only change.

The earlier asynchronous candidate used the local 1.0.4 filename, with SHA-256
`AD4D6C0DC163952B74F516C5631AD258D384FBD34FFF036D1CE60ABB1F7C1398`.
That is superseded local evidence, not the published 1.0.4 installer identity.

Private task evidence is under `.cache/async-*`. In particular,
`async-desktop-final.json`, `async-go-final.log`, packaged QA logs and
`async-audit.log` record implementation checks. The versioned build, smoke and
audit are in `async-110-build.log`, `async-110-smoke.log` and
`async-110-audit.log`. The original-source regression export lives
in `.cache/async-before-source`. It is diagnostic source, not another checkout
to edit or publish.

Real native Computer interaction, populated Hindsight recovery, account-specific
live providers, fresh-machine installation and assistive-technology acceptance
need their own prerequisites. Fixture passes do not establish those results.
This candidate includes no efficiency comparison, savings target or benchmark.

## Coverage boundaries

The full existing suites retain provider-format/failure, parallel-operation,
questions/approvals, plans/goals/queues, teams, hooks/MCP, file/Git/worktree,
history/storage, Fieldnotes/memory, browser/document, recovery, settings and
release-check regressions. New tests specifically exercise the changed receipt,
advisory, consent, cancellation, transport and presentation paths. They do not
constitute a fresh live-provider test for every account or every hardware state.

Additional source-review fixes include stale backend event ownership, split
UTF-8 transport decoding, source-bound memory coalescing, exact message-content
receipts, same-generation configuration refreshes, probability validation,
redirect rejection, bounded transient retries and retained measured usage from
valid responses that become stale before delivery. No dependency was upgraded.

Actual Jev semantic review identified the generic gate unit test as narrower
than a real question lifecycle. The real accepted-answer/provider-failure/retry
regression now also queues background advice while the required question is
pending. Deterministic assertions, not the semantic judgment, establish that
the question remains blocked and the answer survives explicit retry.
