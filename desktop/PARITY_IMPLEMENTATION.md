# Coding workflow parity — local implementation record

This work implements the user-approved reliability and coding-workflow plan.
The 1.0 publication hold remains active. Preserve all preexisting local edits.

## Stages

1. Reliability: durable outcomes, recovered failures, telemetry identities/timing, stale responses.
2. Commands and planning: shared registry, plan revisions, capabilities/fast mode, bounded goals.
3. Specialists and jobs: project opt-in, role profiles, dispatch queue, notifications/wait, background jobs.
4. Hindsight: managed local service, credential broker, separate profile, durable outbox, recall and controls.
5. Browser and hooks: isolated browser, previews, image evidence, reviewed hooks.
6. Integrated acceptance: regression suites, packaged workflows, performance and dependency/secret audits.

## Current evidence

Latest work disclosures, reliable question cards, Tool Activity, provider-failure
recovery, and exact candidate verification are recorded in
[WORK_IN_PROGRESS.md](WORK_IN_PROGRESS.md): 376 desktop tests, Go race/vet,
packaged Windows/Docker workflows, scaling/focus checks, and credential/license
audits. The earlier independent-review candidate also verified native file
confinement, scoped memory, team settings, history preservation, and late goal
usage. Older measurements below describe their recorded candidates.

The six implementation stages are present in the local preview. Integrated live
workflow checks passed. Stable distribution and the external checks below remain
open. Historical evidence is in WORKFLOW_SWEEP_2026-09-27.md.

## Implemented surfaces

| Stage | Current implementation |
| --- | --- |
| Reliability | Versioned durable outcome projections; exact retry recovery; nonzero shell-exit warnings; required verification results; interrupted replay; operation identities/timing; selection generations; retained Docker-path and DecisionBatch fixes |
| Commands/plans | Shared slash, palette and native menu registry; literal slash escape; question cards; editable plan revisions and stale-approval checks; explicit implementation; pending mode changes; capability-aware speed/effort; bounded opt-in goals |
| Specialists/jobs | Project Off/Manual/Automatic defaults; role profiles/endpoints/limits; inherited restrictions; queued slots; bounded state-change waits; follow-up and stop-all; isolated review/integration; process-group-owned background jobs |
| Memory | Pinned Hindsight/PostgreSQL and local weight revisions; separate verified model/credential broker; project banks; durable outbox; deduplication, corrections, tombstones; scoped recall and captured-source freshness; reflection, export, storage/cache controls and verified dump/restore |
| Browser/hooks | Isolated Chromium and project profiles; loopback previews; origin/interaction grants and inherited revocation; snapshots/actions/images/file transfers; raster attachments and review evidence; reviewed bounded hooks with cancellation and verification events |

The Unreal Agent coordinator and canonical session logs remain authoritative.
The Electron writer and two reader workers remain the rebuildable history cache.
No push, remote release, publication, installer installation, or visibility change
was performed. Existing local changes were preserved.

## Final local candidate

- Installer: `desktop/dist-parity-release-check/UnrealCode-Setup-1.0.0-preview.1.exe`
- SHA-256: `F84EDA461E61FAC3454BA9DC909989B09BF188A0C9204ECF99B1B9437E25F677`
- Authenticode: `NotSigned`; publishing remains disabled.
- Backend: `unrealcode:1.0.0-preview.1-84042cdd0195`
- Final packaged parity sweep: `unrealcode-parity-sps8BW`, no renderer errors.
- Final payload audit: 1,010 source/payload entries, 213 production package
  notices, seven local credential values compared privately, zero matches.

Lifecycle projections now include a schema version and invalidate older derived
summaries. Browser grant revocation is checked against the current parent for
existing specialists. Unknown explicit role reasoning overrides fail before
workspace preparation, and Codex catalog/account child processes receive a
credential-filtered environment.

### Current source checks

- Full Go race suite and vet passed; focused image/fast-tier, hook authorization,
  cancellation and screenshot-storage regressions passed after later additions.
- Desktop suite: **190 passes, two optional skips** in the final broad sweep.
  The 100,000-event benchmark was explicitly run separately. TypeScript passed.
  Three Python worker tests passed. Go race/vet passed, including final bridge
  outcome, hook-boundary and screenshot-persistence regressions.
- Actual writer + two SQLite reader workers indexed 100,000 events in 11.86 s.
  Cold search: old JSONL 195.86 ms, SQLite 93.15 ms. Warm median: 8.65 ms vs
  1.42 ms; history page median 3.20 ms. Event-loop p95 19.19 ms, maximum 25.46 ms;
  combined fixture/test peak RSS 213.47 MiB. Host Node SQLite 3.50.4. This is not
  an Electron packaged benchmark or a real-task token-saving claim.
- Offscreen deterministic Electron/Docker sweep passed plan revision validation,
  exact retry recovery, goals, jobs/process-group cancellation, reviewed hooks,
  navigation, Chromium actions/screenshots, and origin rejection. Evidence:
  `unrealcode-parity-M0tQbE` under the Windows temporary directory.
- Live Hindsight retained and recalled synthetic knowledge through a separate
  Codex model profile, then forgot/disabled it. Three requests, 3,128 input and
  160 output tokens; `unrealcode-memory-qa-d8H9ep`. The subsequent pinned-runtime and recovery checks are recorded below.

### Findings from the live Fieldnotes web-app run

Two live Codex implementers generated a self-contained notebook and Python
contract tests in separate worktrees. The first run reached its configured
350,000 reported-token budget while approvals were pending. Work was retained.
The run identified and prompted fixes for:

- Parent TeamWait waking on usage telemetry; waits now use worker-state changes.
- Windows short/long path aliases in owned-workspace metadata on restart. The
  fix verifies canonical equivalence and preserves the recorded storage identity.
- Browser screenshot base64 truncated by the default 40,000-character operation
  bound. Browser output now has a bounded larger allowance. Legacy truncated
  screenshot records produce an unavailable-image explanation instead of an
  invalid provider request. A regression exercises operation serialization.

The retained workers were integrated through the app with recovery copies.
The successful reviewed continuation executed **46 tool calls**, including 32
browser operations. It passed eight Python tests and exercised creating/editing
a note, combined search, persistence, light/dark themes, and empty results.
The preview was stopped using its managed job controls. A later conversation
called MemoryRecall and recovered the verified port and test command.

Continuation usage: 865,065 input, 3,010 output, 828,800 cached-input and 55
reasoning tokens across 46 model responses. The later recall conversation used
10,563 input and 326 output tokens across two responses. Memory inference used
7,497 input / 747 output tokens across five requests at observation. These are
separate scopes; cached/reasoning counts are subsets, not extra totals. Repeated
debugging and original worker history are retained separately and are not a
performance comparison. No token-saving claim is made.

A further actual Codex task deliberately ran a failing Bash command (exit 1),
created the missing file, then repeated the identical command (exit 0). Its
persisted outcome was `completed`; the first failure remained in the trace.
Evidence: `tool-recovery-report.json` in the retained Fieldnotes fixture.

The long-running preview also exposed `setsid` returning before its forked child.
Jobs now use `setsid --wait`; the packaged fixture asserts a sleeping process
remains running before cancelling its owned process group.

## Packaged acceptance and performance

Packaged checks passed coding/approvals/editor/worktree integration, teams and
independent cancellation, queue restart and budgets, bounded verification,
three MCP transports, context/retrieval/compaction, provider handoff, local search,
notifications, local model diagnostics, terminal PATH resolution, offline threaded
history, A→B→A navigation, draft preservation, and backup/recovery.

Light/dark/Windows themes, 100–200% scrolling, 150% accessibility scaling,
reduced motion, keyboard close/focus restoration and tested Axe A/AA rules passed.
The deterministic parity sweep exercises new navigation, local command routes,
plans, goals, pending mode changes, hooks, Chromium and origin rejection.

Hindsight's live packaged recovery test verified a database dump, restored it
into a new private volume, reset consent/model verification, and recalled the
same synthetic fact after explicit re-verification. Evidence:
`unrealcode-memory-qa-036FhL`; five requests, 3,158 input / 138 output tokens at
its pre-restore observation. Source freshness, in-flight forget/correction races,
foreign/unregistered sources and broker authentication have focused unit tests.

Bridge comparison against the pre-change `dist-terminal-pathfix` image, twelve
synthetic runs each, using two independent 250 ms shell tools:

| Scenario | Task median | Steering acknowledgement | Tool overlap |
| --- | ---: | ---: | ---: |
| Baseline, no indexing | 459.38 ms | 1.844 ms | 295 ms |
| Candidate, no indexing | 442.33 ms | 1.855 ms | 295 ms |
| Baseline in separate indexing comparison | 435.79 ms | 1.859 ms | 292 ms |
| Candidate while indexing 100,000 events | 459.28 ms | 2.190 ms | 301 ms |

These runs exclude rendering and checkpoint setup, and varied under concurrent
local tests. They establish preserved overlap/responsiveness in the fixture;
they do not establish real-task speed or token savings.

The final backend `84042cdd0195` was measured again with concurrent 100,000-event
indexing: task median **437.17 ms**, steering **1.822 ms**, independent overlap
**296 ms**. Its comparison baseline measured 472.02 ms / 2.342 ms / 310 ms in
that run (twelve samples each). Differences between repeated runs show why these
small synthetic results are observations rather than an end-to-end savings claim.

## Distribution gates

The installer is an unsigned local preview. The actual payload scan compared
seven locally available credential values and reviewed 213 production dependency
notices with zero matches. The reachable-history audit scanned 1,257 blobs with
zero matches. See OPTIONAL_RUNTIME_INVENTORY.md for pinned optional dependencies.

Signing, fresh-machine installation/upgrades, signed updates, complete assistive
technology coverage and native-window/manual browser takeover on desktop 2 remain
unverified. Live provider evidence uses the existing Codex login. OpenAI/Anthropic
fast-tier wire mapping and requested/actual differences have fixtures; actual
account entitlement and paid-provider performance were not established.

### Evidence boundaries

Jev 1.13.0 was used for bounded claim checks (835 input / 141 output tokens).
It rejected the claim that hook success grants original-operation approval
(contradicted probability .87), and correctly did not establish full acceptance
(.93). Its memory-test sufficiency judgment was uncertain (not-established .68);
the actual race/isolation tests and live API checks remain the evidence.

Tests use disposable projects and offscreen windows because the Browser plugin
is unavailable for Electron. No visible test window was placed outside desktop 2.
Native chrome, full screen-reader coverage, signing, signed updates and a fresh
machine remain unverified. No credentials, changes or release assets were pushed.
