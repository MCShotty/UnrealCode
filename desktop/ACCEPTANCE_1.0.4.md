# UnrealCode 1.0.4 local candidate acceptance

Prepared on 2026-10-01 (Asia/Riyadh) in `I:\UnrealCode`, branch `codex/timeline-density`,
based on `606a2a6821bb76df4ddd3bf3a64f7376f8f83a50`. The implementation is
uncommitted. This is a local candidate record, not publication approval.

## Candidate

| Item | Result |
| --- | --- |
| Installer | `desktop/dist-104-local/UnrealCode-Setup-1.0.4.exe` |
| Size | 225,371,686 bytes |
| SHA-256 | `81E1E12E019F0728C00A9475662678E592BC626E5024317A5ED2C968F4151F67` |
| Manifest | `desktop/dist-104-local/SHA256SUMS`, written and verified |
| Windows signature | `NotSigned` |
| Packaged code | Main bundle and all four SQLite projection/worker files match the built source |
| Source inventory | 769 files in `desktop/dist-104-local/SOURCE_SHA256SUMS` |
| Source inventory SHA-256 | `9B558F675652BCD26805D2CFBA454EAE99ADBF089944E3A3FAEC662A39DD68FD` |

The installer was rebuilt after all eight second-hunt runtime repairs and
regression additions. Subsequent edits only updated this documentation. The source inventory includes those
QA files and is a local inventory, not a hosted build attestation. Install this
unsigned candidate manually. No update release was published.

The earlier local checksum
`8255992CD40ECB6184270389106EEE8EB96B79EA655D30CAF39C5019B2487884`
is superseded by this rebuilt candidate, not a published asset.

Published tags and assets were preserved. The unrelated
`docs/orbit-garden-demo.html` remains untracked with SHA-256
`DA7F98618543892A937AAC6D33FAF6E8CF0C612686C50C4143000E3AAAB5C8A4`.
No dependencies were upgraded or added.

## Verification

| Gate | Evidence and scope |
| --- | --- |
| TypeScript | Both configurations pass on the final runtime source |
| Full desktop suite | **571 passed, 6 opt-in skips, 0 failures**, 577 total, 98 suites |
| Go | Canonical `cmd`, `harness` and `internal` packages pass race tests and vet in the pinned Docker toolchain |
| Backend Docker | Local backend image builds and passes protocol/capability compatibility |
| Computer helper | Build and authority self-tests pass; packaged helper performs its actual versioned handshake and stop |
| OCR and Docker recovery | Eight focused tests pass with English language download/checksum/OCR and two real Docker volume backup/restore fixtures enabled |
| Large history | The existing 100,000-event fixture passes separately, including one writer and two readers |
| Packaged UI | The workflows below ran against `dist-104-local/win-unpacked/UnrealCode.exe` |
| Credentials and licenses | 1,474 source/payload files scanned, 223 installed production npm packages reviewed, seven local credential values compared, zero hits |
| Artifact | Installer manifest verifies and Authenticode reports `NotSigned` |

Local machine-readable reports remain in ignored `.cache/`. The final desktop
report is `.cache/bughunt104-full-final.json`. The earlier
558-pass implementation report remains historical evidence. The OCR/recovery report is
`.cache/104-ocr-docker-recovery.json`; the audit is
`.cache/bughunt104-payload-audit-final.log`. Fixture profiles and screenshots are disposable
Temp directories, never the owner's profile.

### Packaged workflows

| Workflow | Passed behavior |
| --- | --- |
| 1.0.4 timeline and appearance | Actual v1.0.3 worker-generated cache upgrade; retained Fieldnotes, question draft/revision, pane width and manual disclosure choices; cached stages, three-second polling, hidden-page suppression, four-entry feed, 20-entry pagination, evidence reveal and selection preservation |
| Material and navigation | All 20 destinations in both presets; command palette, model picker, repeated navigation, pane/dialog focus, reduced motion changing immediately, forced colors and a stationary 400-event burst |
| Composer controls | Image-only draft, duplicate activation, failed send preserving draft, live steering, scoped pending actions, stop shortcut, task-options validation and failed saves, responsive activity details |
| Work and questions | Required/background questions, independent tool completion, answer drafts, accepted answer surviving a provider failure, explicit retry without repeating answers/tools, history search and historical cancellation state |
| Coding | Approvals, isolated snapshot, Fieldnote receipt/withdrawal, reviewed integration, archive restore, editor/search, unsaved buffer return, conflicts and Plan mode |
| Agent team | Parallel workers, inherited restrictions, individual cancellation, integration conflicts, usage, queue cancellation, restart and request limits |
| Browser and documents | Shared live tabs, exact origin grants, redirects/frames, takeover/revocation, native view hidden behind the app's status menu, PDF rendering/text/search/password handling |
| Memory settings | App-wide setup/navigation, keyboard tabs, provider form drafts and theme/narrow layout |
| Fieldnotes | App-wide local notes, pointer repair, draft/save/edit/withdrawal, Arabic content and read-only authority boundaries |
| Computer UI | Off-by-default grants, actual helper startup/stop, fixture handback, emergency shortcut, themes, scaling and accessibility; no real native input/capture |
| Offline recovery and UI ownership | Missing Docker is a dependency state, retained history browsing/search/pagination, no automatic restart execution, A-B-A response ownership and cross-project Git reply ownership |

The appearance fixture covers **24 combinations**: Cinder Dark, Ice Dark,
Flashbang and Follow Windows, each with Compact/Cozy at 100%, 150% and 200%.
Chat, timeline, Settings and both composer popovers were checked in each
combination. Narrow sheets, full activity details and focus also have separate
workflow checks. Three Axe checks found no violations in dark chat, light chat
and the narrow activity dialog. This does not establish full screen-reader
acceptance. All automated windows were offscreen; no visible checks were run
outside desktop 2 and no native input was injected.

### Second bug hunt

[The second hunt](BUG_HUNT_1.0.4.md) reproduced and fixed eight more defects.
Seven failed first in unit regressions; slow polling failed in the packaged
UI fixture. A follow-up reproduced host-service waiting time before the timing
guard was corrected. Retry-state leakage was investigated but not reproduced,
so no retry implementation fix is claimed.

The final full suite and TypeScript checks ran after all eight repairs. The
new test initially widened a stage phase to a string; its explicit literal
type was corrected without changing the production contract. Eight packaged
workflows passed after the first six fixes. Timeline, work, navigation ownership
and retry checks were repeated after the final two fixes. Earlier Go, Docker,
OCR and helper evidence remains scoped to the unchanged implementations.

A consistent 100,000-event version-six cache upgraded in 3,136.8 ms with a
verified backup and one writer/two readers; main Node event-loop p99 was
18.99 ms. The first raw file-copy fixture omitted WAL records and was rejected;
the accepted fixture uses a consistent SQLite snapshot.

### Failed attempts and harness repairs

Initial focused regressions exposed four implementation failures. A later
cache-upgrade regression failed before the cache rebuild/backup fix, the
contradictory-narrative regression failed before recorded evidence replaced
stale success text, and a rendered project-switch regression failed before
Git reply ownership was fixed.

The initial broad Go invocation also traversed old generated backend copies.
Canonical package race/vet checks passed after narrowing the package paths.

An oversubscribed full run had 75 failures, principally timeouts while builds
and benchmarks ran concurrently. A later two-worker run had one five-second
browser-upload timeout. The focused serial check and the final complete serial
run passed. Timeouts were not increased and checks were not removed.

UI harness repairs updated the old Specialists labels, waited for the selected
conversation to render, selected the root model disclosure instead of its nested
manual-entry disclosure, measured the button's visual surface, and tested an
enabled action. The scaling fixture also needed implicit native dialog selectors
and complete offscreen repaint captures after zoom changes. Fixture-only IPC
values expose connected composer surfaces without enabling backend execution.
The appearance and motion checks passed after these corrections.

### Hosted release preparation

The first hosted Windows run failed an immediate browser-view assertion after
closing an access dialog. A 100 ms native-show IPC delay reproduced that race
locally. The fixture now waits up to three seconds for the actual native child
view, then still asserts attachment and rendered page content. Renderer geometry
alone is not considered completion. No production browser behavior or existing
assertion was removed. The local source inventory above predates this release
fixture and CI/documentation update; hosted provenance binds the final commit.

A later hosted run began with a display-constrained window and correctly hid
the supporting activity rail. A local 1,100-pixel reproduction reached the same
hidden-stage timeout. The appearance fixture now selects its initial wide
viewport explicitly and separately checks that cached stages are reachable
through the narrow Activity dialog and that Escape closes it. Its 24
theme/density/zoom combinations remain enabled. No layout rule was overridden.
The related Git-response and retry fixtures now choose the same starting
viewport; their stale-reply, draft, slow-polling and receipt assertions remain
enabled. Hosted failures are retained in the release preparation logs.

## Fixed findings

| Finding and impact | Repair and regression |
| --- | --- |
| Continuous event arrivals discarded every observer result | Accept the captured event range, overlay newer facts, retain only the newest pending snapshot; slow-inference regression |
| Old work disclosures changed identity when history was prepended | Durable work/segment/event boundaries; stable-key and paginated evidence regressions |
| Closing content was hidden before its fade | Exit before removal; rendered closing and reduced-motion checks |
| Short/unknown timing lost the warnings label | Independent warning suffix; undefined, subsecond and whole-second regressions |
| Plans after milestone 30 disappeared from observer input | Preserve every identity, bound text and include the active milestone; 80/100-milestone regressions |
| New draft plans displaced the executing revision | Retain the approved execution revision and revision-bound progress; planning regressions |
| Queued analysis could outlive withdrawal | Abortable FIFO dispatch, two shared slots retained until real settlement; queued/active cancellation and fairness regressions |
| Activity arrivals reset congestion backoff | Keep dirty work and bounded transient backoff; fake-clock regression |
| Access/consent/profile changes could accept stale narrative or repeat denials | Generation, destination, exclusions and native-provenance checks; denial and stale-response regressions |
| Legacy metadata/cache upgrade could leave incomplete projections | Verified backups before versioned writes; rebuild derived rows from canonical events; interrupted backup/write regressions and packaged v1.0.3 upgrade |
| Feed pagination applied independently around steering messages | One work-wide cutoff/page with durable segment boundaries; 30-call, three-segment rendered fixture |
| Docker recovery blocked offline work/activity/timeline reads | Narrow cache-read dependency allowlist; authority regression and packaged offline fixture |
| Remote browser views covered app menus | Observe app overlay occlusion and restore the view afterward; packaged menu/Escape regression |
| Generated titles leaked advisory markers or cut Arabic mid-character | Strip internal guidance blocks and truncate by rune; Go regressions |
| Reversed clocks produced misleading elapsed/duration values | Mark timing unknown; clock-rollback regression |
| A failed stage still described successful checks | Replace stale narrative with recorded failure/wait/stop evidence; before/after regression |
| Completion collapsed selected work text | Hold selected ranges, focus and reading position; packaged selected-text completion fixture |
| Delayed Git results crossed project/workspace selection | Selection lifetime and latest-request checks, clear unavailable state; failing-before/passing-after packaged reproduction |
| Malformed observer output blocked later work | Block only the failed snapshot; new evidence/progress and explicit refresh can recover |
| Same-revision progress at unchanged event sequence was skipped | Durable progress fingerprint, legacy compatibility and unchanged/changed regressions |
| Slow work polling never settled | One read per selection, coalesce dirty ranges, scoped replies and optimistic preference merge; 2.5-second packaged fixture |
| Disconnect masked a terminal provider failure | Retain terminal state offline; failing-before regression |
| Settled failures accumulated idle time | Accrue pending model/tools/service waits, exclude settled idle and whole human waits; version-seven projection rebuild with verified version-six backup |
| Optional cache write failure rejected readable stages | Best-effort repair, saved metadata retained and concise cache warning; disk-full regression |
| Empty approved plans hid inferred stages | Keep saved stages when no explicit milestones exist; preserve execution revision and inferred status |
| Plan text bypassed observer redaction | Redact model-bound objective, milestones, evidence and prior stages before truncation; synthetic-token regression preserves local approved text |

Completed read grouping is conservative: it requires recorded matching stage,
turn and workspace identity. Calls with missing scope metadata remain separate.
No inferred scope is used to combine legacy calls. Failures, questions,
approvals, steering and final/incomplete answers remain outside the faded feed.

## Performance and observer overhead

Three paired runs used the same 100,000-event fixture across 100 sessions,
separate fresh processes, one writer and two readers. RSS includes worker
threads. No renderer or provider was involved in these paired cache measurements.
Baseline projection source came from the preserved `v1.0.3` tag.

| Median | 1.0.3 | Candidate |
| --- | ---: | ---: |
| Index 100,000 events | 14,176.64 ms | 12,739.38 ms |
| Page query | 3.161 ms | 2.897 ms |
| Work-view query | 0.400 ms | 1.261 ms |
| Peak RSS | 134.57 MiB | 128.39 MiB |
| Main Node event-loop p99 | 21.299 ms | 21.234 ms |

The work query increased about **215%**, or **0.861 ms**, because it now returns
bounded stable segment anchors. This exceeded the relative threshold and was
investigated: growing per-work JSON was replaced by a segment table and cached
prepared statements. The observed query remained below 2.16 ms. Its remaining
absolute cost is recorded here. Page/index latency and memory did not show a
repeatable regression above 10%. An earlier single-session stress run under
concurrent builds was unsuitable for this comparison and was not accepted as
the benchmark result.

The existing original fixture separately measured a 500-event page at 11.445 ms,
main event-loop p95 at 17.793 ms and maximum at 56.754 ms. Its 214.47 MiB peak
includes fixture creation and both JSONL and SQLite paths, so it is not compared
to the paired RSS table. Raw paired results are
`.cache/history104-existing-fixture.json`.

Twelve bridge-only pairs used a fixture provider and two 250 ms tools. The
candidate also had concurrent 100,000-event indexing and two cache search
readers. Median task time was 372.899 ms versus 350.884 ms; steering acknowledgement
was 3.235 ms versus 2.077 ms; parallel tool overlap was 277 ms versus 271 ms.
This excludes real-provider latency and renderer work. A packaged 400-event
renderer burst took 336 ms while preserving scroll position and keeping text
and its ancestors stationary.

A fake-clock observer fixture with one meaningful update per second made
**11 analyses during 30 seconds**, then no further requests during 60 idle
seconds. Its explicitly synthetic provider reported 1,111 input and 187 output
tokens. These numbers verify scheduling and illustrate returned fixture usage, not
real billing or token savings. The steady-state ceiling is now 20 analyses per minute per active
conversation before service latency, shared slots and existing memory limits;
the old 20-second interval allowed three. Real model token overhead still needs
a representative consented workload. Coding/steering never awaits this observer.

## Whole-app review and remaining coverage

The hunt reviewed providers/coordinators, questions/approvals, plans/goals/queues,
teams/integration, hooks/jobs, restart, editor/Git/workspaces, history/forks,
SQLite writer/readers, memory/Fieldnotes, Abilities/MCP, browser/Computer/documents,
startup/recovery, settings/usage/diagnostics, warning controls, release checks,
IPC/credentials and support export boundaries. The full regression suite covers
these modules. Rendered walking of every destination establishes navigation and
layout, not every account-dependent action or OS failure mode.

| Remaining gate or limit | Why it is distinct |
| --- | --- |
| Real native Computer and desktop 2 acceptance | Physical takeover, lock/desktop transitions, captures/input and mixed DPI require the actual disposable desktop fixture; no native test ran |
| Live populated Hindsight recovery and model-authored packaged inference | Local memory metadata, service scheduling and settings fixtures passed; the live service/model/populated-bank path was not exercised by these fixtures |
| Real observer token overhead | Synthetic usage does not measure a user's chosen model/provider |
| Fresh-machine installation | Packaged execution and a generated 1.0.3 profile upgrade do not establish installation on another Windows machine |
| Assistive technology | Keyboard/forced-colors/Axe passes do not replace screen-reader acceptance |
| Fieldnotes 10,000-note combined benchmark | Remains opt-in and was not repeated; the 100,000-event history and bridge/cache comparisons did run |
| External provider/MCP authentication | Existing fake adapters and boundary regressions pass; real account entitlements, sign-ins and remote server behavior remain service-dependent |

Source and delivery claims also received focused Jev checks using `jev-1.13.0`.
Uncertain judgments were treated as review pointers; cached polling gained a
direct regression proving that reads do not queue timeline inference. Raw
judgments remain in `.cache/104-delivery-semantic-result.json`.

No unresolved reproduced defect is being hidden as a skip. These gates and
coverage limits remain visible before any release decision. Native Computer
stays experimental and off by default. The installer is unsigned and has no
GitHub Artifact Attestation because it has not been published.

See [the bug-hunt record](BUG_HUNT_1.0.4.md),
[release notes](RELEASE_NOTES_1.0.4.md), [building](BUILDING.md),
[verification](VERIFY_RELEASE.md), [privacy](../PRIVACY.md) and
[the changelog](../CHANGELOG.md).
