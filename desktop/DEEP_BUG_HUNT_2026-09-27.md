# Deep bug hunt - 2026-09-27

Changes are local to `I:\UnrealCode`. No commit, push, tag, release upload,
visibility change, real-profile migration, or user-project operation was made.
Existing unrelated work was preserved. The 1.0 publication hold remains active.

## Current follow-up: 2026-09-28

The later independent-review fixes and exact rebuilt candidate are summarized in
[WORK_IN_PROGRESS.md](WORK_IN_PROGRESS.md). In particular, host I/O now uses a
native directory-handle boundary, and the previously open Windows junction race
has focused and packaged regression evidence. The earlier entries below preserve
their original test counts and limitations; they are historical evidence.

## Earlier local candidate: 2026-09-28

The unsigned local package is `dist-bug-hunt-20260928r/UnrealCode-Setup-1.0.0-preview.1.exe`, SHA-256 `F14704DC57C25F62D86E72620EB4B793042BA6B6284CACF97BCE256D9EEEBEBE`.
Its Memory settings now use a dedicated Settings tab with a simple chat-model choice, optional separate model controls, direct shared-provider credentials, and an action that verifies and enables the selected project. Offscreen packaged checks passed in Dark, Light, a compact window, 200% scaling, keyboard tab navigation, and axe WCAG A/AA checks. This does not establish real model availability or native screen-reader behavior.

Recovery checks now resolve profile aliases against the physical path, bound small metadata reads, reject malformed or duplicate manifest volumes, preserve ambiguous rollback journals, and verify a Memory database dump before replacing app metadata. A successful Docker inventory may now mark a never-created Memory database as empty, allowing its metadata and pending records to restore without a dump. Docker unavailability cannot produce that marker. If a prior verified dump exists, it is preserved and validated; an existing volume with a missing database container blocks backup. A missing runtime manifest also blocks backup when that runtime's volume still exists. Restoring a dump queues forgotten-record deletions again, while an empty database does not. The static link check does not close the separately confirmed Windows junction-swap race.

Current checks: 270 desktop tests passed, two optional tests skipped; TypeScript and Windows packaging passed; packaged Memory Settings, real-Docker recovery, and a packaged missing-manifest fault injection passed. Live Hindsight retention, recall, database dump, and restore passed on the preceding package, not this exact candidate. The payload audit scanned 1,051 artifacts, reviewed 213 production packages, compared seven available local credential values privately, and found zero hits. Specialist-team, Memory paging, and real-Docker parity checks are historical passes on earlier candidates, not current-package acceptance. Do not infer that the line-by-line bug hunt or 1.0 release gates are complete.

Subsequent source-only findings: a completed background job could report success in memory while its debounced final metadata write failed silently. On restart, the last durable state would still say running and become interrupted. The job list and panel now display a redacted save warning until a later successful save clears it. A regression injected the post-completion failure before the fix, then passed after it. A renderer notification exception during a pending host approval could reject the operation while leaving a stale approval entry; notification failures no longer decide approval state. The same post-commit notification failure was reproduced in specialist metadata, Memory records, MCP grants, browser grants, verification settings, and the task queue. Those notifications no longer undo a saved operation or prevent the queue from scheduling. Each focused regression failed before its fix and passed afterward. Current source passed 278 desktop tests, TypeScript and a code build; these changes are not in the `r` installer.

Recovery finding under mitigation: `Recovery.restore()` imports new session volumes before committing every staged metadata record. A later metadata failure can leave them unreferenced by the live registry. Restore now journals randomized target volume identities before import, validates ownership on Docker creation, and keeps the journal and recovery area for review. Storage lists unregistered planned/imported identities as nonremovable with unknown size. A unit fault injection reproduced the post-import metadata failure; a real-Docker test passed explicit identity, collision refusal and failed-import cleanup, and an offscreen app check showed the Recovery warning. Guided reattachment or cleanup, and a packaged fault-injection run for this exact path, remain open. The original backup is retained; uncertain volumes are not pruned automatically.

Source-only settings finding: `updateSettings()` accepted invalid provider, reasoning, decision, tool and instruction values from IPC and wrote them as if they were typed. `getSettings()` then returned malformed saved values. Main-process validation now rejects malformed patches before write, checks persisted settings at startup, bounds file reads and writes, and preserves bad files for Recovery instead of silently replacing them. Unit regressions failed before the fix; an offscreen app check opened the Recovery screen for a valid-JSON but invalid-provider profile and confirmed its file was unchanged. Current source passed 281 desktop tests, TypeScript and a code build. This work is not in the `r` installer.

Credential follow-up: model and organization admin keys now reject oversized, multiline or NUL-containing values before encryption or persistence. The encrypted secret store is read within a one-megabyte limit and rejects malformed structure instead of reporting a corrupt entry as a missing key. Synthetic credential-context QA confirmed that a matching Windows encryption context decrypts and a different one does not. Current source passed 283 desktop tests, TypeScript and a code build; the packaged candidate remains older.

Settings boundary follow-up: a valid settings file could contain unknown legacy fields, including nested layout fields. `getSettings()` returned these to the renderer and a normal recovery export copied them into `metadata/settings.json` despite the credential-exclusion promise. Tests reproduced both before the fix. Recognized settings and layout fields are now projected at those boundaries, while the live file remains unchanged and saved settings updates retain unknown fields. Private pre-restore, migration, and update backups keep the exact original settings for rollback. Normal exports reject malformed settings rather than mark a raw copy successful. The recovery volume scan now accepts valid settings beyond its old 16 MiB cap. Current source passed 292 desktop tests with two optional skips, TypeScript, `build:code`, offscreen settings-boundary and Settings-navigation QA, and `git diff --check`. A source-plus-older-package audit scanned 1,054 artifacts, reviewed 213 production packages, compared seven available local credential values privately, and found zero hits. The `r` installer still predates these changes. A fresh packaged build and the whole-codebase audit remain open.

Provider URL follow-up: `updateSettings()` accepted a local endpoint containing URL username/password, query, or fragment. The value was saved and returned to the renderer; a legacy copy could appear in a normal backup. A regression failed before URL validation. New values reject embedded credentials and control characters, while valid local HTTP URLs remain supported. Normal backup projection omits an unsafe legacy URL without changing the live file. Current source passed 293 desktop tests with two optional skips, TypeScript, `build:code`, offscreen settings-boundary QA, and a source-plus-older-package credential audit with zero hits. This fix is not in the `r` installer.

Background-job follow-up: if Docker stopping a timed-out job failed, the timer swallowed the error and left the job reported as running, including to host-tool waiters. It now marks the outcome interrupted, records a redacted inspection warning, wakes waiters, and closes the host-side Docker process without claiming that the container process stopped. Separately, a Docker wrapper exiting with code zero before emitting its owned-process preamble was incorrectly reported completed; it is now interrupted with an explicit warning. Both regressions failed before their fixes. The source offscreen parity workflow passed real-Docker background completion and owned group cancellation after the patch; the injected uncertainty paths are unit tested.

Memory-retention follow-up: an idle event previously selected the most recent cached model reply regardless of which turn produced it. A partial idle could retain an older answer under the new turn, and a later reply arriving before the asynchronous read could be misattributed backward. Retention now requires a settled outcome and correlates the reply to the outcome's message or turn identity, bounded by the idle event sequence. Four focused tests cover older/later replies, an unanswered turn, partial idle, and a bounded history page missing its input anchor. The isolated live Hindsight workflow passed model verification, automatic retention, recall with provenance, forget, and disable on current source (four memory-model requests, 3,139 input and 177 output tokens). This check used synthetic project content and an isolated profile; it did not test current-source database backup/restore.

Current source passed 299 desktop tests with two optional skips, TypeScript, `build:code`, `git diff --check`, the real-Docker source parity workflow, and live Hindsight source workflow. The source-plus-older-package audit scanned 1,056 artifacts, reviewed 213 production packages, privately compared seven local credential values, and found zero hits. The unsigned `r` package still predates these fixes. A current packaged candidate, the Windows junction-swap fix, unregistered restore-volume repair, bounded long-term job/team/memory storage, and the full line-by-line audit remain open; nothing was pushed or published.

Browser grant follow-up: `ProjectBrowser.configure()` activated a broader in-memory origin grant before its disk write committed. A failed write left access enabled for that run. The code now keeps only the intersection of old and requested grants while the save is pending, commits the new grant after durable replacement, restores the old grant on failure, and serializes concurrent updates. A saved grant is validated on load; damaged metadata is kept unchanged until the user explicitly saves a replacement, at which point a dated original copy is retained. The read is capped at 1 MiB. The browser takeover action now checks the current origin grant before bringing a tab forward, while Close remains available for cleanup. Failed-request logs now show origin and network error code without URL path/query content. Regressions reproduced the failed-save exposure, invalid stored permissions, and takeover bypass before the fixes; tests cover pending grants, recovery, size limits, and log redaction. The current source passed 306 desktop tests with two optional skips, TypeScript, `build:code`, and an offscreen real-Docker/isolated-Chromium workflow for navigation, interaction, snapshots, screenshots, and origin rejection. The source-plus-older-package audit scanned 1,056 artifacts, reviewed 213 packages, compared seven local credential values privately, and found zero hits. These source changes are not in the `r` installer; the broad audit and release gates remain open.

MCP and host-operation follow-up: the broker mutated live connection/grant/catalog records before a synchronous metadata replacement, so a failed save could activate uncommitted authority. Connection edits and removals could also lose or misapply credentials; a changed endpoint could inherit an old bearer if credential cleanup failed after the new config committed. Broker writes now commit a proposed record first, then expose it. Endpoint edits remove old credentials before making the new endpoint active and restore them if the metadata commit fails. Revocation stops live project calls before attempting the durable grant removal. New tool calls reject disabled/stale catalog entries and validate against the currently stored schema. Saved connections, grants, catalogs, and host-call records are bounded and validated before loading; invalid originals remain unchanged. Host operations no longer keep a ghost `started` record after a failed pre-execution write or an undurable `finished` result after a failed final write. Fault-injection regressions failed before these fixes.

The exact current source passed 314 desktop tests with two optional skips, TypeScript, `build:code`, and an isolated offscreen MCP workflow covering Windows stdio, container stdio, remote HTTP, approvals, redaction, compaction, and context exclusions. The source-plus-older-package audit scanned 1,056 artifacts, reviewed 213 production packages, privately compared seven local credential values, and found zero hits. The `r` installer is older than these changes. Long-term record growth, Windows junction path swaps, unregistered restore-volume repair, fresh-machine acceptance, and the full line-by-line audit remain open; nothing was pushed or published.

MCP tool-selection follow-up: `grant()` accepted guessed tool names before discovery, and a server could later add or change a tool under that name. The prior name-only grant then enabled the new definition without renewed selection. A failing regression confirmed pre-authorization. Grants now bind each selected tool name to its reviewed catalog revision; unknown names and stale revisions are rejected. An old saved name-only grant remains loadable but inert until the user selects the advertised definition. The Connections UI shows only current definitions, flags changed selections, and passes their revisions explicitly. The strict Go bridge still receives its original catalog shape; the UI-only current-definition flag stays in the Connections view. An initial offscreen three-transport run caught the protocol mismatch and was rerun after the fix. The final isolated workflow passed host, container, and remote MCP calls, UI checkbox deselection/reselection, approvals, redaction, compaction, and retrieval. Current source passed 316 desktop tests with two optional skips, TypeScript, `build:code`, and `git diff --check`. The source-plus-older-package audit scanned 1,056 artifacts, reviewed 213 production packages, privately compared seven local credential values, and found zero hits. No installer or remote release contains this source change yet.

Docker CLI follow-up: container MCP startup/cleanup, backend launch, recovery volume transfers, and evaluation commands still invoked `docker` by bare name. Electron's packaged environment can fail to resolve it even when Docker is installed, especially at the final PATH entry. Each runtime path now uses the shared Windows resolver with the same credential-filtered child environment; container MCP cleanup retains its startup executable. A failing transport test confirmed the bare-name call before the fix. Current source passed 317 desktop tests with two optional skips, TypeScript, `build:code`, a real-Docker volume export/import integration test, and offscreen recovery and three-transport MCP workflows. The recovery workflow verified backup, durable session restore, credential exclusion, trust reset, stopped restart, support redaction, and damaged-profile preservation. The source-plus-older-package audit scanned 1,057 artifacts, reviewed 213 production packages, privately compared seven local credential values, and found zero hits. Packaged Windows validation for these newest source changes remains open; the full codebase audit is still in progress.

MCP OAuth follow-up: authorization URL validation accepted `ftp://localhost` when the discovered issuer had the same origin and state; the scheme check treated any loopback hostname as sufficient. Saved credential metadata could also supply an external callback redirect. Failing tests reproduced both. Authorization now requires HTTPS or HTTP on loopback, with no URL user info and the expected issuer origin/state. Saved callbacks are accepted only as bounded `http://127.0.0.1:<nonzero-port>/callback` URLs; an invalid value is ignored and a new interactive sign-in allocates its own loopback callback. A callback listener startup failure previously left the listener and nonce state uncleared; a separate fault-injection test failed before the fix and passes with cleanup spanning the entire sign-in. Malformed callback request targets receive HTTP 400. Current source passed 320 desktop tests with two optional skips, TypeScript, `build:code`, the local PKCE/token-exchange fixture, and the isolated three-transport MCP workflow. The source-plus-older-package audit scanned 1,058 artifacts, reviewed 213 packages, privately compared seven local credential values, and found zero hits. Fresh packaged OAuth testing and the broader audit remain open.

Connection-vault follow-up: clearing a memory-only MCP credential removed the in-memory value before reading and replacing the saved vault. If an unrelated saved entry was damaged or the disk write failed, the operation rejected while losing the live credential. A clear with no persisted entry also created an unnecessary vault file. Decrypted JSON was returned without checking that it was a bounded object; `null` could break the Connections view. Fault-injection tests reproduced these cases before the fix. The vault now reads first, writes only when a persisted entry exists, and drops the memory value after a successful clear. New and decrypted credentials must be bounded objects; temporary files are cleaned after replacement attempts. If one saved credential cannot be read, Connections still lists its server with an unavailable credential state and a recovery hint rather than failing the entire page. Current source passed 325 desktop tests with two optional skips, TypeScript, `build:code`, and the offscreen three-transport MCP workflow. The source-plus-older-package audit scanned 1,058 artifacts, reviewed 213 packages, compared seven available local credential values privately, and found zero hits. The `r` installer predates these source changes; full-codebase and packaged acceptance remain open.

Task-queue follow-up: Add, Resume, review completion, and other work-admitting queue mutations changed in-memory state before metadata replacement. Injected failed saves left a ghost task, an active in-memory queue after a failed Resume, or an isolated task marked completed without a durable integration record. These regressions failed before the fix. Queue edits, ordering, retry, remove, settlement, Add, Resume, and review completion now restore their prior in-memory state if the save fails. Restrictive pause/review/input states remain fail-safe in memory. Saved queue data is validated before restart adjustments, and an invalid provider is rejected before a new task is written. Replacement attempts clean temporary files. Current source passed 331 desktop tests with two optional skips, TypeScript, `build:code`, and an isolated two-project workflow exercising sequential queue execution, concurrent projects, handoff, context exclusions, local search, notifications, and required input. A source-plus-older-package audit scanned 1,058 artifacts, reviewed 213 packages, privately compared seven credential values, and found zero hits. A crash or repeated disk failure after the backend creates a new session but before its session ID is saved still needs a dedicated reconciliation path; the full audit and packaged acceptance remain open.

Queued-session handoff follow-up: after the backend created a session, a failed queue save or an uncertain `send` left the session active while the task was merely marked failed; no stop was attempted. Regressions reproduced both paths before the fix. The queue now pauses immediately, marks the linked task interrupted, attempts to stop the session, retains its ID and redacted diagnostic, and records when stopping cannot be confirmed. A restart from a `starting` record without an ID points the user to session history instead of claiming there is a linked session. Current source passed 335 desktop tests with two optional skips, TypeScript, `build:code`, and the isolated two-project queue workflow. If the backend creates a session but the response never returns its ID, exact automated reconciliation is still unavailable; inspecting session history remains necessary. Persistent disk failure can likewise prevent the link from reaching the queue file. No code or installer was pushed or published.

## Confirmed findings and fixes

Each finding had a failing regression before its fix. File references below are
relative to `desktop/`.

| Priority | Finding and demonstrated impact | Fix / regression |
| --- | --- | --- |
| P1 | Renaming an isolated task changed its project-path hash. Reopening allocated new empty desktop locations, making retained context and checkpoints unreachable through the app. | `src/main/storage-migration.ts` remaps project identity keys and binds legacy child storage to the new path. `storage-migration.test.ts` reopens the migrated child and reads its original content. |
| P1 | Interrupted relocation with both old and new folders present returned success and deleted its journal. The conflicting copies remained without recovery tracking. | Recovery now blocks and retains its journal on the conflict; neither copy is deleted. Regression starts with both paths present and verifies the journal remains pending. |
| P2 | Restoring evaluations with timestamp locations updated the volume registry but left the report pointing to the old volume. Later cleanup rejected the mismatch. | `src/main/recovery.ts` resolves the backed-up location registry and remaps the report to its newly restored volume. Legacy and timestamp layouts are tested. |
| P2 | App-wide implicit cancellation groups caused concurrent history reads for different sessions to cancel each other. | `src/main/history-cache.ts` makes cancellation explicitly scoped to a caller, and starts it before asynchronous history preparation. Independent page/search readers remain concurrent. Obsolete query cancellation does not show an application failure notice. |
| P2 | Changed-filename search entries disappeared when the cache was reconstructed after restart. They depended on an in-memory map of live event sequences. | The worker anchors persisted checkpoint files to their recorded turn, using message IDs. `workspace-runtime.test.ts` rebuilds with no live events and finds the filename at its original completed turn rather than a later unrelated message. |
| P2 | Native `ENOMEM` failures became generic/build failures. Resource exhaustion could also be hidden by cache-specific wording. | `src/main/failures.ts` recognizes resource exhaustion before feature-specific fallbacks. Fixtures cover cache, build, and provider scopes. |
| P2 | A delayed history response from the first A selection could be merged after A -> B -> A navigation. Session ID equality alone did not identify the current selection. | `src/renderer/App.tsx` uses a selection generation for navigation and background refresh results. The offscreen UI regression injects a delayed older snapshot and checks it is discarded. |
| P2 | A send acknowledgment cleared the composer even when the user had typed a new draft while waiting. | Only the unchanged submitted draft in the same selection is cleared. An offscreen renderer regression types while the send response is delayed and checks that new text survives. |
| P3 | Editor recovery folders still used UUIDs, missing the date/time storage requirement. | New copies use atomically allocated UTC timestamp directories, including same-millisecond collision handling. Existing directories join the backed-up migration. Twelve concurrent allocations and prior recovery-content preservation are tested. |
| P2 | Session-list caching could hide newly created forks and provider handoffs until a later refresh. The packaged handoff workflow could not find its continuation immediately after completion. | The runtime invalidates metadata snapshots after session/task creation and linking. A fresh list is read when needed; background history backfill remains asynchronous. A fork regression and the real Docker handoff workflow cover it. |
| P2 | A transient Windows sharing denial aborted task/checkpoint metadata replacement. The packaged coding run retained an uncommitted task metadata temporary file and reported access denied. | Both stores now use the existing bounded atomic replacement helper, retaining original metadata and cleaning temporary files. Injected `EACCES`/`EPERM` regressions verify the same task identity and checkpoint complete successfully. |

The migration findings demonstrate lost reachability or recovery tracking, not
permanent deletion of canonical conversation logs. The draft bug concerns text
that had not yet been submitted.

## Verification

- TypeScript: passed.
- Desktop tests: **152 passed**, one optional performance benchmark skipped.
- Go: `go test -race -count=1 ./cmd/... ./harness/... ./internal/...` passed in the
  pinned Go build image under Docker `--init`. This includes coordinator,
  parallel operation, cancellation, approval, native file, replay, usage,
  provider-adapter, context, MCP, team, and verification tests.
- `go vet ./cmd/... ./harness/... ./internal/...`: passed.
- Python decision worker: **3 tests passed**.
- Rendered race regressions: both failed before their fixes and passed afterward.
- All seven final packaged acceptance workflows below passed; no reported page errors.
- Final payload audit: **940 files/artifacts**, **212 production packages**, **7 local credential values compared privately**, **zero secret hits**. Secret-detector self-test also passed.
- `git diff --check`: passed (only existing LF/CRLF conversion warnings).

### Test-environment corrections

The first broad Go run omitted an init process. Tests that wait for child-process
reaping failed; the app uses `tini`. The targeted rerun and entire race suite passed
with Docker `--init`, without changing Go source or weakening process assertions.

A real Git migration fixture hit Vitest's five-second default while Go compilation
ran concurrently, then cleanup raced the still-running Git process. Its deadline
is now twenty seconds; all original file-integrity and registration assertions
remain. The full desktop suite passed afterward.

Launching five offscreen Electron acceptance suites concurrently caused startup
and interaction stalls. Only owned fixture processes were stopped. The final
packaged acceptance checks were rerun serially; this does not establish support
for five simultaneous application instances.

## Scope and limits

Static inspection prioritized session/cache ownership, event replay, migration,
backup/restore, approvals, process cancellation, checkpoint indexing, and renderer
async state. Deterministic fixtures and the full suites provide evidence for the
exercised paths; this is not a claim that every possible bug has been eliminated.

Browser plugin unavailable: rendered checks use the repository's Playwright
Electron harness with disposable offscreen profiles. No visible windows were
opened outside virtual desktop 2. App provider checks use local fake endpoints; no production OpenAI/Anthropic/Codex
credential test, native screen-reader acceptance, fresh-machine installation,
signed update check, or new performance benchmark claim is included. TypeSafe was used for bounded evidence/impact
classification; tests establish the reproduced bugs and fixes.

## Final packaged evidence

All rows passed on the final unsigned package. Fixture folders and screenshots
are retained under `C:\Users\CaptainMcShotgun\AppData\Local\Temp`.

| Workflow | Evidence folder | Checks |
| --- | --- | --- |
| Coding and editor | `unrealcode-coding-DzUMNr` | Approvals, isolated snapshot, integration, archive/restore, editor save/search/conflict, selection-to-chat, Plan mode |
| Workflow | `unrealcode-workflow-5TKsBI` | Independent projects, ordered queue, required-input pause, handoff linkage, context exclusions, search, notification routing |
| Recovery | `unrealcode-recovery-faDQl3` | Real Docker backup/restore, long history, credential exclusion, trust reset, stopped sessions after restart, damaged profile retained |
| History and scrolling | `unrealcode-history-ui-Yn9pxS` | Packaged workers, offline history/search/pagination, missing Linux pipe, scroll preservation, dark/light/system at 100/150/200 percent |
| Renderer races | `unrealcode-ui-races-NfamQL` | Discard stale A-B-A response; retain draft edited during pending send |
| Connections | `unrealcode-connections-35mZTO` | Host stdio, container stdio, remote MCP, retrieval and context compaction |
| Accessibility | `unrealcode-accessibility-dKd3vu` | No Axe violations in checked flows; 150 percent scaling, reduced motion, keyboard close and focus restoration |

## Local installer

[UnrealCode-Setup-1.0.0-preview.1.exe](I:/UnrealCode/desktop/dist/UnrealCode-Setup-1.0.0-preview.1.exe)

SHA-256: `F022D398AB4FF6BFC5892BAAEA07C8324FE5EA9C5B9A9BED00FA7C2566520B4D`

Authenticode: **NotSigned**. This is a local preview, not a published stable
release. The real user profile was not migrated or installed over during these
checks. The previous initial-implementation installer hash is historical; this
is its replacement.

## 2026-09-28 continuation — current local candidate

This section supersedes the test counts and installer reference above for the
current uncommitted candidate. The 1.0 push/publication hold still applies.
The earlier security scan is an immutable snapshot of the prior source state:
`5a234cc9-5ae1-4436-9a14-7cc7c4f672d5`. It reported six source-backed
findings with **partial** file coverage. Do not treat its open-finding badges as
the current patch's remediation status without reviewing the changed source.

### Confirmed failures now mitigated

- MCP project revocation left a Windows-hosted server running in another task
  workspace. Host-trust downgrade had the same project-scope mismatch. The
  broker now closes all matching live instances and rechecks grant revision
  after asynchronous connection steps. The sibling-workspace and in-flight
  revoke regressions failed before the fix and pass now.
- MCP credential input accepted values shorter than the response redactor's
  eight-character minimum. Short values are now rejected. A separate
  regression also caught a secret echoed inside nested JSON text; the
  redactor now handles raw and JSON-escaped forms. These checks do not claim
  protection against arbitrary transformations performed by a server.
- Browser access confirmation showed a path-qualified URL even though the
  stored grant covered the whole origin. Such entries are rejected before
  approval, and the dialog shows canonical whole-origin access.
- Skill discovery, SkillUse, and runner .env loading accepted unbounded file
  content. Reads now require regular files and byte limits; discovery also
  bounds entries and aggregate skill bytes. Linux-container regressions cover
  oversized files and symlinks.
- Rebuilding the shared history cache with Docker unavailable replaced
  browsable offline history before canonical logs could replay. The backend
  now blocks that rebuild and preserves the cache; the online fixture waits
  for current-session replay before reporting success. Additional
  multi-project and inactive isolated-session recovery cases still need
  scrutiny.
- Decision preflight's whitespace-based replacement exposed the remainder of
  quoted, multiword credentials. Preflight and post-change checks now withhold
  the full evidence field when known credential markers are present. Synthetic
  regressions cover quoted and multiline values. This is not a universal
  credential scanner.
- Concurrent session-setting writes shared one `.tmp` path and could collide,
  while read/modify/write changes could erase an unrelated field. Temporary
  paths are unique, and settings mutations use a config mutex. Parallel write
  and two-field update regressions pass under Go's race detector.
- On stdin EOF the bridge waited for pending requests before cancelling them;
  a request awaiting host input could hang shutdown. EOF now cancels first,
  covered by a blocked-dispatch regression.
- A crash leaving a partial final activity-log line prevented replay and
  future appends. The log now saves the partial bytes privately, removes only
  that incomplete tail, and resumes the next sequence. Valid JSON lacking a
  final newline is separated before appending. Complete malformed lines still
  produce errors for investigation.

### Current verification

- Desktop tests: **195 passed, 2 skipped**; TypeScript typecheck passed.
- Full Go race suite and `go vet` passed in the pinned build image with
  Docker `--init`, matching the app's `tini` process reaper. The same
  child-process cleanup tests failed repeatably without an init process;
  that is a test-container condition, not a waived application assertion.
- The full Go race/vet run was repeated after the bridge metadata and event
  recovery fixes; the desktop bridge race suite passed again after expanding
  the credential-marker cases.
- Online fixture: plan revisions, stale approval rejection, recovered tool
  failure, bounded goal, background job, hooks, navigation, and online
  history rebuild passed.
- Packaged offscreen fixtures passed for offline history/rebuild,
  dark/light/system UI and 18 destinations, host/container/remote MCP, and
  Memory Settings at compact size and 200% scaling. Checked axe flows had
  zero violations; native window placement was not exercised.
- The synthetic bridge comparison used 12 runs per image. Median parallel
  tool overlap was 278 ms before and 277 ms after; steering acknowledgment
  was 1.80 ms before and 1.68 ms after. With 100,000 events indexed
  concurrently, candidate overlap was 271 ms and steering acknowledgment
  was 1.75 ms. These fixture observations do not imply real-task savings.
- `npm audit --omit=dev` found zero reported vulnerabilities; `go mod
  verify` passed. The refreshed local payload/notice/credential audit scanned 1,035
  files or artifacts and 213 production packages, compared seven local
  credential values privately, and found zero matches.
- A disposable Docker volume probe confirmed that the runtime image's
  unprivileged user can write and later read the `/state` mount. This
  strengthens the open container-state-isolation finding without touching
  any user session volume.
- Go statement coverage is uneven: the desktop bridge measured 60.1%;
  coordinator 96.1%, operation 88.4%, primitives 96.5%, and the new bounded
  file reader 71.9% in its focused package test. Coverage identifies where
  to inspect next; it does not prove the remaining lines are defect-free.

Local unsigned installer for the refreshed source:
`desktop/dist-bug-hunt-20260928b/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`0474A742BC426575BF1C6B7EE24138389F9AFC5BC6A8C8F5CD2A17F299DFDADA`.
Its packaged offline-history and fake-provider parity smoke checks passed.
Authenticode remains `NotSigned`.
No installation over the user's running app, commit, push, or publication
occurred.

### Coverage still open

The repository-wide security scan had partial coverage. This continuation
validated selected findings and exercised broad automated suites, but it did
not manually review every source line. Container state isolation for
agent-run commands, bounded MCP schema validation, host-side path-swap
confinement, and repository-remote host selection need further investigation
or remediation. The history rebuild path also needs a lossless strategy for
cached isolated sessions whose containers are inactive. Fresh-machine,
signed-update, native assistive-technology, and live external-provider
checks remain outside the evidence above.

The focused TypeSafe Jev 1.13.0 check supported the event-tail recovery claim
but marked broad, universal config-concurrency and credential-detection claims
not established. Those outcomes are advisory; the narrower claims above rest
on source review and concrete tests.

## 2026-09-28 continuation — MCP schema isolation

The previous goal turn made progress; this continuation inspected another
authority boundary. A disposable Ajv child process using an MCP-style
`^(a+)+$` schema and a nonmatching 100-character argument exceeded a one-second
timeout. The previous broker compiled and ran that server-controlled regex on
Electron main, where it could freeze the whole desktop app.

- Tool schema compilation and argument validation now run in a four-worker
  pool with a 1.5-second per-check timeout, a 15-second catalog-validation
  deadline, bounded queued work, and worker replacement after timeout or
  cancellation. JSON Schema pattern matching remains functional for normal
  tools. A timed-out definition is held back until its revision changes.
- Calls are registered for cancellation before asynchronous validation. The
  broker rechecks the exact project grant, live connection, and catalog entry
  before sending validated arguments to the MCP server. Queued validation
  notices abort immediately when their operation is cancelled.
- App maintenance now disconnects servers while preserving the validator for
  later reconnect. Reinitializing connections disposes the old worker pool.
  This avoids both a broken post-backup MCP workflow and orphaned workers.
- The packaged recovery fixture still targeted a page that became a Settings
  tab during the UI overhaul. It now selects the Recovery tab before checking
  its heading; the rerun passed. This was a stale test route, not proof of a
  new application UI defect.

TypeScript typecheck and the full desktop suite passed: **198 tests passed,
2 skipped**. Focused tests show a main-thread timer and an independent schema
call complete while a pathological regex is stalled, reject the malicious call
before it reaches the server, and cover active and queued cancellation. The
fresh packaged candidate passed host/container/remote MCP, compaction,
retrieval, backup/restore, credential exclusion, trust reset, damaged-profile,
and support-bundle checks. Its local payload audit scanned 1,038 files or
artifacts, reviewed 213 production packages, compared seven local credential
values privately, and found zero matches.

Local unsigned installer for the MCP isolation candidate:
`desktop/dist-bug-hunt-20260928d/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`58591DA9FBADDF823E5FC83D183DD62F5C425785E2F8A9C822D6952CE150B45E`.
Authenticode remains `NotSigned`; the 1.0 push/publication hold remains in
force. No real user profile was installed over.

Remaining security work still includes separating agent-run commands from
durable container state, Windows host-side path-swap confinement, and GitHub
remote host selection. This worker boundary limits schema CPU stalls; it does
not sandbox a malicious MCP process or prove all schemas terminate quickly.

## 2026-09-28 continuation — GitHub remote authority

The GitHub workflow trusted any syntactically valid hostname in the project's
`origin`. It passed that hostname to `gh --hostname`, and Fetch/Pull invoked
Git against the configured remote without a host check. A remote URL could also
contain embedded HTTPS credentials or parameters without being rejected.

- Repository operations now accept GitHub.com or an exact GitHub Enterprise
  hostname with an active successful account in `gh auth status --json hosts`.
  The status request omits `--show-token`. HTTPS/SSH remotes containing URL
  credentials, ports, queries, or fragments are rejected.
- Fetch and Pull use the validated literal remote URL and current branch;
  changing Git config between validation and the command cannot redirect those
  commands through the `origin` name. Push requires the reviewed remote and
  commit snapshot, and uses that exact URL and commit. No unpreviewed Push
  fallback remains.
- Source tests reject untrusted hosts and credential-bearing URLs before
  network operations, confirm an authenticated enterprise host, and inspect
  pinned Fetch/Pull arguments. A disposable local bare Git remote verified that
  the explicit Fetch refspec prunes deleted tracking branches and that explicit
  `pull --ff-only URL branch` advances the checked-out branch.

The full desktop suite passed: **201 tests passed, 2 skipped**; TypeScript
typecheck passed. The final packaged candidate launched in the offscreen
offline-history fixture. The local payload audit scanned 1,038 source/payload
artifacts, reviewed 213 production packages, compared seven credential values
privately, and found zero matches. No live GitHub write or enterprise-account
test was performed; those paths remain fixture-verified.
Jev 1.13.0 treated short-evidence claims about all origin API calls and
remote-swap prevention as not established, and rejected a claim about every
possible Git network action. The assertions above are scoped to the inspected
`github.ts` paths and the executed tests.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928e/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`DC57D5AFDC63A310495DE7F95831620F2EF7A9E634AE629D3852E3210810DC7B`.
Authenticode is `NotSigned`. Nothing was committed, pushed, uploaded, or
installed over the user's active profile. The 1.0 publication hold remains.

The disposable Git command fixture remains under the system Temp directory.
Automatic approval review rejected its recursive cleanup, so it was preserved
instead of retrying that removal through another shell.

## 2026-09-28 continuation — host file size and skill concurrency

The next file-boundary review found that preview, editor, and checkpoint capture
checked a path's size before calling unbounded `readFile`. A concurrent file
growth could allocate far beyond the UI or checkpoint limit before rejection.
Checkpoint blob replay also read app-data objects without a byte cap. Skill
listing read every discovered `SKILL.md` without per-file or total limits, and
skill saves checked UTF-16 character count instead of UTF-8 bytes.

- Shared `readBoundedRegularFile` reads through an open handle in fixed chunks
  and stops at the configured byte limit. Project preview and editor use 1 MiB;
  skill listing uses 512 KiB per file and 4 MiB total; checkpoint file/blob
  reads use 8 MiB and metadata reads use 16 MiB. Changed size, modification
  time, or file identity during a read causes a retry error.
- Skill enumeration stops after 128 directory entries. Saved skill content is
  checked by UTF-8 byte length. Same-skill saves and deletes are serialized per
  canonical project and skill name; different skills remain independent.
  UUID temporary paths and cleanup prevent collisions and abandoned temp files.
- A real Windows regression with twelve simultaneous skill saves first failed
  with `EPERM` rename errors, then passed after serialization. Stale-size and
  oversized-blob fixtures verify that the bounded reader rejects before an
  unbounded project/blob read. The normal editor, checkpoint, and skill tests
  continue to pass.

The full desktop suite passed: **208 tests passed, 2 skipped**, with TypeScript
typecheck. The refreshed packaged candidate passed offscreen coding/editor and
recovery workflows. Its payload audit scanned 1,039 artifacts, reviewed 213
production packages, compared seven credential values privately, and found
zero matches. TypeSafe Jev 1.13.0 supported the narrow read-bound and skill
serialization claims; its broader junction-race judgment was uncertain and
is not used as proof.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928f/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`AF0EB3818542905453F17160642F6AFA9104220B704AB11B27B2A2C9B04812C2`.
Authenticode is `NotSigned`. No commit, push, upload, or installation over the
owner's active profile occurred.

**Open:** These byte limits do not close the Windows junction/symlink swap
between path validation and host-side write/rename/unlink. A fully enforceable
fix needs operations relative to trusted directory handles or an equivalent
Windows native confinement boundary, followed by adversarial race tests.

A controlled Windows probe confirmed the related read-side race. It moved a
temporary project subdirectory aside, installed a junction to a separate
synthetic outside directory only while `fs.open` ran, then restored the safe
directory before the app's second path check. `readFile` returned the outside
fixture marker. The probe used disposable files under Temp and was removed
from the normal test suite afterward; no owner project or secret was read.
The check-after-open reduces ordinary accidental escapes but is not an
enforceable confinement boundary against a racing local process.

## 2026-09-28 continuation — image attachment lifecycle

The image picker had another stat-then-unbounded-read path for user-selected
images. During a multi-image batch, it stored earlier images before validating
the last one; a failed batch leaked pending IDs. The composer also kept only
three visible chips while allowing a new pick to store extra IDs, and removing
a chip did not release its main-process image data until the one-hour expiry.

- Image files now use the 4 MiB bounded reader. A multi-selection is committed
  to Electron's pending-image map only after every image validates. The map's
  30-image cap checks the proposed batch before allocation.
- A narrow typed `images:discard` preload call releases pending data when a
  chip is removed or project image state is cleared. The composer supplies its
  remaining 1–3 slots to the picker, disables picking while a dialog is open,
  and discards a completed selection if project navigation made it stale.
- A new offscreen workflow used a real PNG and a damaged image. It confirmed a
  rejected batch left no stored image, thirty valid pending images reached the
  cap, and discarding one made room again. The same workflow passed against
  both the source build and the refreshed packaged app.
- The same workflow exposed that damaged and excess selections were reported
  with a generic fallback. The shared failure classifier now gives specific
  damaged-image, size, and image-count guidance. Focused tests and the source
  and packaged image workflows verify the user-facing messages.

The desktop suite passed **212 passed, 2 skipped** with TypeScript typecheck.
The final local payload audit scanned 1,040 artifacts, reviewed 213 production
packages, privately compared seven credential values, and found zero matches.
This does not establish that every supported image decoder rejects a tiny file
with maliciously enormous pixel dimensions; that resource-exhaustion case
remains to be tested separately.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928h/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`2F9A34920F2365AB381F04112CA11643E29AEF1ECFDF0DA75AEBEF0FF8C5D724`.
Authenticode remains `NotSigned`; nothing was committed, pushed, published, or
installed over the active owner profile.

## 2026-09-28 continuation — image decode limits and WebP

The prior image byte cap did not bound decoded pixels. A small compressed PNG,
JPEG, or WebP could advertise a very large canvas. A real WebP fixture also
failed after header validation because Electron's `nativeImage` supports PNG
and JPEG, while the picker advertised WebP. See Electron's
[nativeImage format documentation](https://www.electronjs.org/docs/latest/api/native-image)
and Google's [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container).

- A bounded header parser now rejects images above 8192 pixels per side or
  16 megapixels before decode. It parses PNG, JPEG, and still WebP headers,
  checks WebP canvas and frame dimensions, and rejects animated PNG/WebP.
  Decoder-reported dimensions are checked again after PNG/JPEG decoding.
- Still WebP is converted to capped PNG data in a hidden sandboxed Chromium
  window with no Node integration or preload, a 10-second timeout, a two-job
  concurrency cap, and window cleanup. No additional image-decoding package or
  model asset was bundled.
- Unit tests cover all three WebP bitstream container forms, oversized canvas
  and frame headers, animation flags/chunks, and malformed data. The offscreen
  source and packaged workflow successfully attached real JPEG and WebP files,
  rejected an oversized header, and confirmed the converter window closed.

TypeScript and **214 desktop tests passed, 2 skipped**. The current packaged
image workflow passed; the payload audit scanned 1,043 artifacts, reviewed
213 production packages, privately compared seven credential values, and
found zero matches. Jev 1.13.0 supported the narrow WebP-workflow claim and
did not establish a universal decoder-memory bound. Header limits reduce the
allocation risk but do not prove that malformed images cannot trigger larger
internal decoder allocations or a decoder vulnerability.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928i/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`197B9F93ABBEF025A6FE69D4460919490391453927F4EA84C3D2D6A5B870C6DD`.
Authenticode remains `NotSigned`. Nothing was committed, pushed, published,
or installed over the owner's active profile. The confirmed Windows junction
swap remains open and separate from these decoder fixes.

## 2026-09-28 continuation — metadata limits and Memory settings

Additional metadata paths were checked after the image work. Bounded JSON
readers now cover project hooks, team preferences, connection credentials,
task plans, task queues, and verification workflows. Oversized metadata is
rejected while the original file remains available for recovery. Task-plan
evidence and queue messages have per-record caps; failed initial verification
workflow saves restore their in-memory state. Decision override replay now
streams JSONL, skips oversized malformed records, and serializes concurrent
appends from separate store instances. Focused tests cover these limits and
malformed encrypted credential-store shape.

Memory setup is now a peer **Settings → Memory** tab with the same two-column
card hierarchy as primary Provider settings. The model controls are on the
left; credential status and per-project activation are on the right. Copying
the chat provider uses saved chat settings rather than unsaved edits in the
Provider tab. Changing memory providers clears a stale local endpoint.
The settings page retains keyboard tab navigation and the separate project
Memory workspace for retained-record inspection.

TypeScript, 223 desktop tests (2 skipped), source and packaged Memory Settings
QA, settings keyboard navigation, dark/light WCAG A/AA automation, compact
window and 200% zoom checks passed. One MCP schema-worker test's 250 ms fixture
deadline expired only during the parallel full suite; its focused rerun passed.
The fixture deadline was widened to 1000 ms without changing production
validation timeouts, and the full suite then passed.

Local unsigned installer:
`desktop/dist-memory-settings-20260928/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`B1E3315BB802EB94F3A00140F62B710AC2A90553CB7BE772CEA9CFDE1D477A31`.
Authenticode is `NotSigned`. The payload audit scanned 1,045 artifacts,
reviewed 213 production npm packages, privately compared seven local
credential values, and found zero matches. No commit, push, publication, or
installation over the owner's profile occurred. The confirmed junction race,
unbounded high-volume memory/team/job metadata, and fresh-machine acceptance
remain open; this section does not claim a complete per-line audit.

## 2026-09-28 continuation — background jobs and Hindsight recovery

The background-job store could leave a new job in memory as `starting` when
its initial metadata write failed, even though no container process launched.
Replaying the same request could return that ghost job. Admissions now serialize
only the reservation/write phase, remove failed reservations, and prevent a
queued launch after workspace shutdown. Independent running jobs remain
parallel. A malformed or oversized process-ID preamble now leaves an
`interrupted` outcome with an ownership warning instead of calling an
unhandled stop that cannot prove process ownership. Launch failures are
persisted before return. Seven focused background-job tests cover failure,
concurrency, shutdown, and preamble cases. Jev 1.13.0 supported the narrow
state labels `interrupted` for unknown container outcome (confidence 0.98)
and `cancelled` for a prelaunch shutdown (confidence 1.0); code and tests,
not Jev, enforce the behavior.

Hindsight's runtime manifest now has a 1 MiB bounded read. Starting or
stopping the runtime settles pending requests and cleans up a failed startup;
startup cancellation cannot publish a late ready state. A fresh runtime
reserves its Docker volume identity in metadata before image preparation,
and later launches honor that validated identity even if Windows spells the
same profile path differently. Recovery still derives a new volume when
`restoreRequired` is set, and now refuses to proceed without its verified
database dump. Unit tests cover alternate path spelling, restore allocation,
missing backup, failed preparation, and request cancellation.

The first packaged Hindsight run timed out while preparing a new cache. Its
worker mount was present and its progress reached the pinned reranker. That
cache contained an incomplete weight; a later run completed the download
and passed. The app now offers **Retry memory service** in Settings and the
Memory workspace, with a specific startup-timeout explanation. The retry
path was exercised by stopping only the API container belonging to a
disposable QA profile, then clicking the Settings button. The same flow
passed in the current package.

That repeat run exposed an outbox starvation bug. A forgotten record whose
upstream deletion failed was always chosen first; later pending turns never
retained. The outbox now gives each item bounded attempts, continues past a
failure, displays unresolved deletions explicitly, and retries them on user
request. It drains persisted work after startup and waits for in-flight
metadata writes on stop. A deliberate runtime stop leaves an item pending
without consuming a failure attempt. The Hindsight API documents
[synchronous retain and stable document IDs](https://hindsight.vectorize.io/developer/api/retain)
and [document deletion](https://hindsight.vectorize.io/developer/api/documents);
the app retains tombstones rather than silently treating a deletion 404 as
proof that every historical volume is clear.

The current patch passed TypeScript and **243 desktop tests, 2 skipped**.
Source and packaged real-Docker parity checks passed background completion,
owned cancellation, hooks, and navigation. Source and packaged Hindsight
flows passed provider verification, private service startup, retry,
retention, recall, forget tombstoning, and disable. Packaged Memory settings
passed dark/light automated accessibility, compact window, and 200% zoom.
The package audit scanned 1,047 artifacts, reviewed 213 production npm
packages, privately compared seven credential values, and found zero hits.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928l/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`CDC12ACA3A696F3BEFEF948D93277AFEB4AA31AE9410F4AAE57FE94C8D3DE673`.
Authenticode is `NotSigned`. No commit, push, publication, or owner-profile
installation occurred. Older disposable QA profiles created memory volumes
before the alias fix; those volumes were preserved because ownership and
content must be reviewed before cleanup. The confirmed Windows junction
swap, high-volume metadata growth, old-volume reconciliation, fresh-machine
install, and a complete per-line audit remain open.

## 2026-09-28 continuation — storage registry recovery and bounded Memory history

The timestamped storage registry had a crash window. A complete
`storage-locations.json.pending` could remain after a failed replace while the
next startup read only the older committed file. A second allocation could
then assign a different physical folder to the same logical key. Registry
reads are now bounded to 16 MiB and validate each entry. A pending registry
is promoted only when it is a verified extension of the committed one.
An older subset is discarded; conflicting copies remain untouched and block
allocation with an actionable error. A malformed pending copy is preserved
under a dated filename while a valid committed registry stays usable.
Five focused tests cover first-write recovery, successor promotion, stale
subsets, conflict preservation, and damaged/oversized files. Existing storage
migration tests passed unchanged.

Memory status previously cloned and sent every retained record on each
five-second view refresh, even though a project can hold 10,000 records of
up to 24 KiB each. Status now includes the total count and at most 50 recent
records; Settings requests counts with no records. A project-scoped cursor
API loads older records in bounded pages, and a single-record read refreshes
corrections and forgotten items. The renderer keeps loaded pages across
ordinary updates, resets when a high-volume gap or smaller restored set
requires a fresh cursor, and clears unsaved editor text immediately after a
successful forget. A 125-record offscreen source and packaged fixture loaded
all pages and verified the older-record forget behavior.

The current patch passed TypeScript and **251 desktop tests, 2 skipped**.
The packaged 125-record Memory workflow and real-Docker parity workflow
passed. The prior live Hindsight retry evidence remains recorded above;
the memory runtime changes are unchanged here. The exact current
package audit scanned 1,050 artifacts, reviewed 213 production npm packages,
privately compared seven local credential values, and found zero matches.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928n/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`84321905CB14102887A92D2919962CC22522F4700ECB3E25272F30C894D60566`.
Authenticode is `NotSigned`. No commit, push, publication, or owner-profile
installation occurred. Memory's canonical JSON store still reads and rewrites
its full history for mutations; this renderer paging fix does not make that
store threaded or bounded. The Windows junction race, older alias-created
memory volumes, background-job/team metadata growth, fresh-machine install,
and a complete per-line audit remain open.

## 2026-09-28 continuation — specialist shutdown under storage failure

Specialist-team shutdown previously saved `paused` state before stopping any
workers. If that metadata write failed, the method returned early and left
workers running. A user-requested stop had the same ordering flaw. Both paths
now attempt their actual parent/worker stops even when the pause record fails,
then report any unconfirmed stop or save failure. Workspace shutdown now
continues closing browser jobs, background jobs, the repository and bridges
after a team failure, and reports incomplete cleanup at the end. Independent
child runtimes are stopped once each.

A denied team resume now persists its limit reason before throwing. Team views
exclude the request-permit journal before cloning, avoiding a potentially
100,000-entry copy on the inspector path. Direct worker resume also bounds
follow-up text and rejects steering a worker that has no retained session.
Focused tests cover failed pause writes, unconfirmed worker stops, cleanup of
other workspace services, durable denial, journal omission and resume bounds.

TypeScript and **256 desktop tests passed, 2 skipped**. The exact packaged
specialist workflow passed parallel workers, inherited restrictions,
individual cancellation, review/integration, restart and request limits.
The payload audit scanned 1,050 artifacts, reviewed 213 production npm
packages, privately compared seven credential values, and found zero matches.

Current local unsigned installer:
`desktop/dist-bug-hunt-20260928o/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256:
`10FE937EEA9F49C3AE311F83A986167F2405A496B096A37261202C5D35D6E981`.
Authenticode is `NotSigned`. No commit, push, publication, or owner-profile
installation occurred. The monolithic team request journal and memory outbox
still grow without an efficient canonical store. A failed team metadata write
can leave visible in-memory state ahead of disk until restart, although new
worker launches and shutdown errors are now handled more conservatively.
The confirmed Windows junction race and the broader per-line audit remain open.

## 2026-09-28 continuation — Memory Settings and queued create recovery

Memory now appears as a first-class Settings tab with a direct Provider and
Model ID form. The extra "choose another model" switch was removed; "Use chat
model" remains a shortcut. Credentials and project enablement stay visible in
their own cards, and usage limits remain collapsed. The offscreen Electron
fixture passed dark and light accessibility checks, keyboard tab navigation,
compact-window scrolling, and 200% scaling. The current installed/packaged
candidate still predates this source change.

Queued session creation previously generated a new backend ID on every
retry. If the bridge committed a session but lost its reply, another attempt
could create a duplicate session or a second isolated worktree. Queue launches
now retain a stable attempt UUID and reviewed workspace choice. The Go bridge
serializes keyed creates, checks existing session/config ownership, and returns
the same session without replacing its log. A bounded Electron retry uses the
same key; a linked task retry allocates a new attempt. An unchanged interrupted
worktree may be reused, while edits, incomplete snapshots, changed Git
registration, and existing session links block automatic reuse. The queue
records created links before later team setup, and restart repairs a missing
worktree link from the durable queue record.

The same session volume could also be mounted by two concurrently running
desktop backends. Because the underlying Unreal Agent local file store allows
replacement of a session ID, a per-process create mutex was insufficient.
The Linux bridge now holds a kernel file lock for the volume throughout its
process lifetime. A second backend receives an actionable conflict; a crash
releases the lock without deleting retained state. The bridge lease test,
a two-container same-volume collision fixture, and the real-Docker queued
worktree workflow passed after this change.

Verification: TypeScript, 339 desktop tests (2 skipped), the full Go bridge
suite in Docker, and the queued-create Go race test passed. An offscreen
real-Docker Git fixture created a queued isolated worktree, ran a Bash tool,
and retained the linked result for review. The two-project queue workflow
also passed with context, search, handoff, notifications and required input.
All changes remain local. A current-source-plus-older-package audit scanned
1,063 artifacts, reviewed 213 production packages, privately compared seven
local credential values, and found zero hits. No current-source installer was
built or audited. Windows junction path swaps,
unregistered restore volumes, long-term memory/job/team record growth,
fresh-machine/signing gates, and the complete per-line audit remain open.

## 2026-09-28 continuation — retained restore repair and recovery actions

A failed restore could import a Docker session volume, then fail while writing
later metadata. The previous journal kept the planned volume name but not its
Docker ownership token or project mapping. New journals persist those values
before import. The volume registry and backup verifier now reject duplicate
project or volume mappings, control characters in project paths, malformed
records, and oversized registry files without rewriting the original data.

Settings → Recovery now lists retained imports separately. It distinguishes
planned/missing volumes, Docker outages, in-use volumes, verified ownership,
and mismatched or legacy ownership. Verified idle copies can be exported as
private session files for manual recovery. When the source project still exists
and has no mapped session volume, reattachment shows the recorded and resolved
paths, binds the operation to that preview, saves the previous registry, and
registers the verified volume. Post-registration ownership changes roll the
mapping back. Existing mappings are never overwritten, and no retained volume
is deleted automatically. Legacy journals without an owner token remain
visible but require manual inspection before export or reattachment.

The failure banner previously advertised Retry, Docker setup/open, backend
rebuild, and cache rebuild actions through an IPC method with no handler.
Those actions now reach bounded checks or the existing rebuild paths. Docker
help uses Docker's current Windows setup guide. Retained-session failures
route to the Recovery tab. An unrelated Save settings button was removed from
the Recovery and Usage tabs.

Current evidence: TypeScript, `build:code`, **349 desktop tests with three
optional skips**, two real-Docker recovery integration tests, offscreen
retained-volume UI export/reattach and legacy-journal checks, dark-mode WCAG
A/AA audit of the new Recovery controls, and mocked Docker open/help actions
passed. A current-source-plus-older-package credential/license audit scanned
1,066 artifacts, reviewed 213 production packages, compared seven local
credential values privately, and found zero hits. The `r` installer predates
this work; no current-source package or fresh-machine check was run. Windows
junction path swaps, cleanup of old unverified restore volumes, long-term
memory/job/team record growth, signing/fresh installation, and the complete
line-by-line audit remain open. No commit, push, upload, or publication occurred.
