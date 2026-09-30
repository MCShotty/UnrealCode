# Fieldnotes and managed Computer — local candidate

## 1.0.3 release promotion — 2026-09-30

The owner subsequently authorized committing, merging and publishing these changes
as 1.0.3. The local 1.0.2 candidates and results below are dated historical
evidence, not the published 1.0.3 artifact. The release workflows now run the new
packaged reliability, Fieldnotes, Computer startup and delayed-navigation checks.
Hosted Go race/vet and Docker compatibility results are separate from the local
Docker outage. Native input/capture, live Hindsight recovery and fresh-machine
acceptance remain explicitly unverified; Computer is experimental and off by
default. Published verification uses the v1.0.3 release manifest and attestation.
Earlier release tags and assets are preserved.

Date: 2026-09-30. Branch: `codex/fieldnotes-computer`, based on `270870a`.
The existing three local commits and unrelated `docs/orbit-garden-demo.html` are preserved.
No push, merge, tag change, or publication is authorized by this task.

## Implemented

- All seven planning-audit defects: unique/revision-checked skill creation; editor reload ownership; ordered session refresh; per-project session/error state; MCP resource/prompt revocation; bounded pagination; memory provenance checked against dispatch-time and current revisions.
- Fieldnotes navigation and welcome entry, Markdown originals, project/session attribution, drafts, local saves, explicit inclusion/exclusion, context receipts, pointer repair, export, withdrawal and background interpretation. Relevant guidance crosses projects with source labels. Originals are UI-authored; no model tool edits them.
- Timestamp canonical storage and an additive schema-2 upgrade with verified metadata backup. Existing SQLite writer/two readers project note search and receipts. Eight complete notes/16 KiB; superseded guidance invalidates dependent summaries and memories. Workers inherit accepted parent guidance; internal continuations retain it; new queued tasks resolve guidance at dispatch.
- Shared two-slot memory inference dispatch across note interpretation, timeline analysis, and Hindsight inference. Notes remain usable when memory is disabled. Interpretation results are bound to note revision and profile generation; unknown quoted evidence is rejected.
- Managed Computer page, chat companion, command, Abilities link, built-in guidance skill, selected-window task grants, global ownership, physical-input pause, explicit handback, stop and emergency shortcut. Plan mode is observation-only. Unknown/consequential actions get exact host approval. Native workers cannot compete. Known legacy add-on calls cannot compete with managed control; migration preserves configuration and withdraws overlapping grants across projects.
- Bundled self-contained Windows helper adapted from Windows MCP v1.3.25, commit `6f54a68d41cca0d98a94b80855d9404579ca65d7`. It runs service code as a library, not the upstream MCP server. Locked dependencies, SDK 10.0.401, source/executable manifest, dispatch guards, UI Automation mutation guards, password-field masking, and no screen-region capture fallback.
- Temporary screenshots use expiring opaque references; only cloned outgoing provider requests receive image bytes. Canonical events never receive unpinned PNG data. Revocation, destination changes and restart invalidate access. Explicit pinning creates a normal image attachment.
- Cinder Dark, Ice Dark, Flashbang, responsive pointer sheets, folded-note and selection accents, handback feedback, stationary previews and reactive reduced motion. Main controls use the existing ExpressiveButton and ProgressIndicator.

## Earlier implementation verification (historical)

| Check | Evidence |
| --- | --- |
| Full desktop suite | 500 passed, 6 skipped across 79 files. Skips include explicitly gated benchmarks/native acceptance. A new canonical-receipt regression was added afterward and its seven-test focused suite passes. |
| TypeScript | Both renderer/shared and main/preload configurations pass. |
| Go | Full `go test -race ./cmd/... ./harness/... ./internal/...` and `go vet` passed in `golang:1.27.1-trixie`. Focused Fieldnotes and ephemeral-image tests pass. |
| Python decision worker | 3 tests passed. |
| Helper | Release build and authority self-tests pass: ownership, observation-only access, pause/handback epochs, window change, stop, and local preview boundaries. |
| Real renderer | `qa-reliability.mjs` reproductions pass. `qa-fieldnotes.mjs` passes offline library, pointer attribution without trust, drafts/cancel, themes, accessibility, narrow layout and reduced motion. |
| Real helper process | `qa-computer.mjs` passes actual bundled startup/stop with no native input or capture, emergency-shortcut registration, default-off grants, themes, accessibility and 200% scaling. |
| Docker | Current bridge image builds and required-capability check passes. Packaged coding workflow passes approvals, isolated edits, integration, archive/restore, editor conflict handling and Plan restrictions. The guided workflow additionally verifies accepted Fieldnotes reaching a fixture provider and disappearing after withdrawal. |
| Credentials | Reachable-history audit: 1,925 blobs, 31,133,574 bytes, seven local credential values compared, zero hits. Pattern regression passes. Initial payload audit: 1,420 files and 223 npm packages, zero credential hits; final digest is recorded below. |
| Jev review | Actual `jev-1.13.0` bounded reviews support advisory provenance, input ownership and ephemeral image claims; computer-review confidence ranges 0.80–0.93. This is supplementary evidence, not a substitute for native tests. |

### Performance

Actual 10,000-note canonical library plus simultaneous 100,000-event indexing:

- Cold note projection load: 2,712 ms.
- Warm local search: **53.3 ms p95** (target below 150 ms).
- Send preparation with bounded original-text receipts: **107.8 ms p95**.
- Event-loop delay: 19.8 ms p95, 23.8 ms maximum; process RSS 167 MiB.
- Actual worker identities: one writer and two readers.

The first large-note run timed out because a SQLite FTS left join repeatedly evaluated
matches. Materializing the bounded hit set fixed the measured failure; the complete
combined fixture then finished in 17.3 seconds. Fixtures contain synthetic English
and Arabic text; no provider inference or native input is included in these numbers.

Twelve synthetic Docker runs per candidate (two independent 250 ms shell tools):

| Metric | Baseline `270870a` | Candidate with 100,000-event background indexing |
| --- | ---: | ---: |
| Median task time | 441.0 ms | 470.6 ms |
| Median steering acknowledgement | 1.55 ms | 1.37 ms |
| Median tool overlap | 296 ms | 297 ms |

Task wall time increased 6.7% under the added indexing load; steering and overlap
remained responsive. This compares a synthetic bridge workload and excludes renderer,
checkpoint setup and live-provider latency. It does not establish token savings.
Live memory-model overhead has not been measured; interpretation tests use fixtures.

Additional existing 100,000-event history benchmark passed: SQLite warm search
1.73 ms median, history page 2.78 ms median; JSONL warm search 10.52 ms median.
Cold searches were 100.3 ms (SQLite) and 179.0 ms (JSONL). These are fixture-specific,
not a claim about all real conversations.

The guided end-to-end check exposed an additional bug: Go omits empty receipt
arrays, whereas the UI expected `omitted` to exist. Projection/replay normalization
and defensive rendering now cover that shape, with a regression and the actual
provider workflow. The packaged candidate was rebuilt afterward.

## Acceptance gates still open

- **Visible native control on desktop 2:** desktop 2 was created following the prompt,
  but repeated Windows checks continued to report desktop 1 active. No native fixture was
  launched or native input sent on desktop 1. The legacy coding QA script lacked
  its offscreen flag; this was corrected before the successful workflow checks. The compiled disposable fixture and opt-in
  `computer.native.test.ts` are ready. Actual clicking/typing, physical takeover,
  window-handle reuse, modal interruptions, lock/unlock, mixed DPI/multiple monitors,
  and a real-app artifact workflow remain unverified. Authority unit tests do not
  replace these checks.
- **Live memory/Hindsight:** real model processing, outages, and full private recovery
  restoration with a populated Hindsight bank need the configured runtime and model.
  Revision, deletion, failure and offline behaviors have deterministic coverage.
- Fresh-machine installation, signing and distribution are outside this local candidate.
  Existing published releases remain unchanged. Do not present this as release-ready.

## Earlier local artifact (superseded by the bug-hunt candidate below)

- Installer: `I:\UnrealCode\desktop\dist-fieldnotes-local\UnrealCode-Setup-1.0.2.exe`
- Size: 225,354,588 bytes. Authenticode status: **NotSigned**.
- SHA-256: `91224013D976FD51A4F6655357151903E5A204881B0A1CBE7062140CDD8B1D1B`.
- `SHA256SUMS` is beside the installer. The unpacked app is in `win-unpacked`.
- Final packaged checks: guided coding workflow (receipts and withdrawal included),
  Computer startup/stop and UI checks, and credential/license audit all passed.
  The payload audit inspected 1,420 files, reviewed 223 npm packages, compared seven
  known local credential values, and reported zero hits. Helper dependency/runtime
  notices cover 35 entries in addition to the pinned upstream MIT license.
- Published assets and tags were not changed. Package version remains 1.0.2 in this
  separate local directory; this is not an updater publication or replacement release.
- The rejected cache cleanup left a 119-byte Vitest result under root
  `node_modules/.vite`; this generated cache is ignored. No user content was removed.

## Bug hunt: 2026-09-30

The following twenty defect groups were repaired locally. Reproductions use
disposable profiles and fake providers; native capture/input boundaries are
additionally checked in helper self-tests. These checks do not prove actual
Windows input, lock, desktop switching, or mixed-DPI behavior.

| # | Defect and repair | Regression evidence |
| --- | --- | --- |
| 1 | Inherited duplicate submissions returned a newly built receipt or another task's context. Read and validate the canonical winner. | `fieldnotes.test.ts`: duplicate inheritance and ownership |
| 2 | An unavailable receipt cache blocked continuation despite preserved originals. Read canonical receipts independently. | Receipt-cache outage fixture |
| 3 | A partially updated receipt cache hid the latest accepted guidance. Merge canonical originals with accepted replay evidence. | Failed projection after a newer accepted receipt |
| 4 | Cache rebuilds and transient/initial batch failures hid saved notes. Track rebuild generations and incomplete projections until a complete reseed succeeds. | Rebuild, failed writer, and 33-note/failed-first-batch fixtures |
| 5 | Input-anchor fallback could retain another explicit turn's response. Reject mismatched known turn IDs. | `memory-retention.test.ts` |
| 6 | Observer summaries could publish after newer evidence arrived without changing work state. Check the current event-range endpoint. | `timeline.test.ts`: delayed response after new events |
| 7 | Moving a Fieldnote pointer left duplicate memory rows and superseded attribution. Move the stable document between source buckets. | `hindsight-memory.test.ts` |
| 8 | A delayed helper integrity read could launch Computer after it was disabled. Invalidate startup generations. | `computer.lifecycle.test.ts` |
| 9 | Closing a helper before its ready event threw before stopping it. Settle startup and stop the unready process safely. | Unready-child fixture |
| 10 | Queued native grants/handbacks could revive authority after Stop or takeover. Cancel queued requests and check their epochs under the authority lock. | Helper authority self-tests |
| 11 | A 250-event scan could miss earlier native observations and retain derived screen prose. Check full indexed context, including inherited history and explicit pinned-evidence provenance; incomplete indexing fails closed. | `history-cache.test.ts` with 401-event conversations |
| 12 | Delayed browser uploads continued after cancellation, takeover/handback or revoke/regrant. Recheck ownership and grant epochs before mutation. | Three `shared-browser.test.ts` delayed-CDP fixtures |
| 13 | Delayed cancellation reopened an old note after selecting another. Bind save/cancel/delete continuations to selection and preserve the originating draft. | Real renderer `qa-bughunt.mjs` reproduced Alpha replacing Beta |
| 14 | Computer grants could use a different model destination from the reviewed dialog. Bind and validate the displayed destination; invalidate stale review state. | Reviewed-destination boundary test and typed IPC |
| 15 | One failed metadata write ended shutdown's barrier before other writes settled. Await all settlements before surfacing failure. | `atomic-metadata.test.ts` delayed second writer |
| 16 | Failed goal saves left live scheduling inconsistent with disk state. Restore the prior scheduling state on failure. | `task-planning.test.ts`: failed resume and pause |
| 17 | An out-of-order guidance configuration could revive retired notes. Reject stale generations and older revisions. | `fieldnote_authority_test.go` plus source-extracted Windows execution |
| 18 | Credential masks were truncated with the first 500 model-visible elements; scoped captures omitted other controls and oversized windows allocated before bounds checks. Collect all known masks and validate scope/geometry before capture. | Helper mask/scope/allocation self-tests; actual PNG masking remains a native acceptance gate |
| 19 | Computer wait returned the full app status, exposing another task's project. Return the same task-safe status projection as the status tool. | `computer.test.ts` foreign waiting-task fixture |
| 20 | Credentials in note/pointer/window titles escaped body-only redaction. Sanitize all model-facing metadata while preserving authored originals. | Fieldnote and Computer synthetic-credential fixtures |

### Current verification scope

- Final desktop suite: **523 passed, 6 explicitly skipped, 0 failed**. The JSON
  result is `.cache/bughunt-tests-final.json`. No failed regression was disabled.
- TypeScript passes. The bundled helper builds with locked dependencies and its
  expanded authority/capture self-tests pass.
- Linux-target Go vet passes across the bridge, harness and internal packages;
  the complete bridge test binary cross-compiles. Two isolated authority tests
  execute on Windows using functions extracted verbatim from current source.
  This is not execution of the Linux bridge or the full Go race suite.
- Source renderer checks passed for reliability, Fieldnotes, Computer and the new
  delayed-cancellation reproduction. They use offscreen disposable windows.
- The current Linux Docker pipe remained unavailable after background startup;
  no new Docker workflow or Linux Go race result is claimed for this revision.
  Windows currently lists only desktop 1, so actual native input was not run.
- Earlier performance numbers and Docker evidence above belong to the earlier
  candidate. They were not remeasured for the bug-hunt installer.
- Actual Jev boundary screening and semantic verification used `jev-1.13.0`.
  Post-change positive judgments ranged from 0.73 to 0.91; the native-input
  acceptance claim scored 0.06. Raw questions and responses remain in `.cache`.
  These judgments are supplementary to the regressions and open gates.

The working branch and published releases are unchanged. The unrelated demo's
SHA-256 remains `DA7F98618543892A937AAC6D33FAF6E8CF0C612686C50C4143000E3AAAB5C8A4`.

### Current local installer and packaged evidence

- `I:\UnrealCode\desktop\dist-fieldnotes-local\UnrealCode-Setup-1.0.2.exe`
- Size: **225,357,214 bytes**. Authenticode: **NotSigned**.
- SHA-256: `5EACD09646E1F1C7F16DD562E8D4FE2E477984185D41B04BEC34D739FB92C5D7`.
- The adjacent `SHA256SUMS` matches this installer. The previous local checksum
  above is superseded; published release assets were not replaced.
- Packaged `qa-bughunt.mjs`, `qa-fieldnotes.mjs`, `qa-computer.mjs --packaged`
  and `qa-reliability.mjs` passed on disposable offscreen profiles. This verifies
  the actual package's renderer, cache workers and helper startup/loading.
- Packaged artifacts: `%TEMP%\unrealcode-bughunt-VEvC2l`,
  `%TEMP%\unrealcode-fieldnotes-qa-bhrvzH`,
  `%TEMP%\unrealcode-computer-ui-rZ8t2a`, and
  `%TEMP%\unrealcode-reliability-jAbL2t`.
- The final payload audit inspected **1,425 files**, reviewed **223 installed npm
  packages**, compared **seven known local credential values**, and found **zero
  hits**. Helper dependency/runtime notices cover 35 entries. These audits are
  bounded checks, not a claim that the application has no remaining bugs.
- The package includes the monotonic guidance generation fix in both Electron
  main and Go backend source. The final source still needs the Docker/race,
  live-memory, native input and fresh-machine gates described above.
