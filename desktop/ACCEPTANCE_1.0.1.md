# 1.0.1 acceptance evidence

Status: v1.0.1 published and its downloaded assets verified on 2026-09-29 (Asia/Riyadh). See [published artifact evidence](RELEASE_VERIFICATION_1.0.1.md) for the exact tag, commit, hosted runs and public checksum. The local candidate checksums below are historical and differ from the published installer.

Installer: `dist-1.0.1/UnrealCode-Setup-1.0.1.exe`.
Local SHA-256: `690a65c04b091356f9a7628987974b62eb329b3f212497a9f789d9f738554ad7`.
Both the installer and unpacked application report `NotSigned`. `SHA256SUMS` was generated and verified against this installer.
The bug-hunt candidate replaces the palette build `a14cac7d...` and the earlier feature candidate `a8f21236...`; public v1.0.0 is unchanged. The palette build passed branding/native-scheme checks in `unrealcode-branding-3Ft8hc`. The current rebuilt payload audit found zero hits across 1,135 files and 207 dependency notices.

## Verified

### Release-notification candidate

- PR #1 passed hosted Windows/backend/Go checks and merged at `baaf121`. Its nonpublishing preflight passed tests, packaging and audits, but failed capturing a resized offscreen screenshot (`UnknownVizError`). The capture helper now waits for rendered frames, retries only this compositor error up to three attempts, and still rejects empty/failed captures. Functional assertions remain unchanged. No tag or release was created by the failed preflight.
- Hosted Windows acceptance at `bb15f3e` exposed the asynchronous update-checkbox bounce. Recovery preferences now update immediately, roll back on failure, and invalidate stale background polls. The same UI regression passes locally (`unrealcode-release-notice-TJqJ9m`); hosted acceptance must pass on the follow-up commit before merging. The local installer checksum above identifies the earlier build, not this source correction or the eventual hosted installer.
- Full desktop suite: **455 passed, 3 optional skips, 67 files**. TypeScript and production packaging pass. GitHub discovery tests cover versions/channels, required assets, owned URLs, pagination/ETags, malformed replies, deduplication, offline caching, retry/reset limits, scheduler cadence, preferences, and persistent dismissal.
- Fresh Go race and vet checks pass for `cmd`, `harness`, and `internal` with Go 1.27.1 in Docker. Formatting passed for 233 LF-normalized source files, matching Linux CI's checkout; the working tree's Windows line endings were preserved.
- Packaged notification UI (`unrealcode-release-notice-WusyU2`) passed: manual checks with automation off, nonmodal focus behavior, light/dark at 150%, reduced motion, allowed release links, unsigned download/install rejection, saving other settings without undoing opt-out, and dismissal across restart. Responses are synthetic GitHub fixtures, with no token or visible external browser.
- Disposable profile upgrade (`unrealcode-upgrade101-YePTCS`) passed using a local packaged 1.0.0 preflight app and the 1.0.1 candidate. Instructions, theme, provider/model, session identity/title, and original canonical events were preserved. This is a profile-upgrade check, not a fresh-machine installer test.
- Packaged Docker workflow (`unrealcode-101-qa-u14vuq`) built/tested the fixture app, retained refusal failures, browsed memory without a project and discovered 10 Codex catalog models. It observed 1,155 ms of parallel overlap, with zero renderer errors.
- Final local payload audit: 1,141 files, 207 dependency notices, seven local credential comparisons, zero hits. Reachable-history audit before the release commit: 1,618 blobs, zero hits. Checksum fixture tests and secret-pattern tests pass. No runtime dependency was added.

The earlier feature, palette and bug-hunt results below are historical supporting evidence. Hosted release checks must still establish the exact tagged artifact's checksum and provenance.

### 2026-09-29 bug-hunt follow-up

Six confirmed issues were fixed: stale specialist-memory promotion receipts, inference dispatch after stopping, stale timeline results after task/plan changes, optional-memory failures hiding factual history, separate memory budgets permitting excess dispatch, and shutdown replaying an earlier rejected metadata action. See [BUG_HUNT_2026-09-29.md](BUG_HUNT_2026-09-29.md) for reproductions and regression locations.

The final desktop suite passed **430 tests with 3 optional skips across 66 files**. Eleven new regressions cover cancellation/startup settlement, promotion races, failure/progress ownership, unavailable-memory fallback, shared request/token accounting, concurrent request deduplication, and shutdown after a rejected edit. TypeScript and unsigned packaging pass. The packaged history/recovery rerun (`unrealcode-history-ui-0wwJ7d`) passed with zero page/console errors. No new live-provider or Hindsight ingestion calls were made for these fixes; actual HTTP-broker tests use fake providers. The Go source is unchanged by this follow-up; prior Go race/vet results below remain the relevant earlier evidence.

### Brand palette follow-up

The local candidate was rebuilt after applying the supplied cobalt/red/steel/white reference. Filled primary actions use exact `#0027CC` and white; dark-mode text and focus use accessible lighter blue. The UC mark keeps its silhouette with a red square and a cobalt light-mode variant. Steel-neutral surfaces, selected controls, stop/error states, terminal ANSI colors, and editor diff backgrounds share semantic tokens. Layouts and existing motion are preserved.

The legacy layout rule forcing native `color-scheme: dark` was removed. `qa-branding.mjs` now checks native controls during light/dark/system switching. Offscreen Electron checks passed at 100/150/200% scaling, including the narrow picker, Escape/focus restoration, and reduced motion. All 28 sampled text/semantic pairs meet 4.5:1 contrast (minimum 4.67:1; cobalt/white 9.71:1). Screenshots in `unrealcode-101-qa-aGvBdQ/screens` were visually reviewed. The accessibility rerun (`unrealcode-accessibility-pzB2Gu`) reported no violations, overflow, or page errors. Browser plugin unavailable; these checks used the repository's Playwright Electron harness. These are rendered-app checks, not native desktop-placement evidence.

### Feature verification

- TypeScript checks and production renderer/main/preload build pass.
- Full Go race suites and vet pass for cmd, harness, and internal packages in the pinned Go 1.27.1 image. Tests use Docker `--init` so process-group cancellation can reap orphaned children.
- Original feature baseline: 419 passes and 3 optional skips across 65 files, superseded by the 430-test bug-hunt run above. PostgreSQL initialization, maintenance settlement, stale observer responses, and timeline pagination regressions are included. The three Python worker tests also passed during feature acceptance.
- Packaged Electron/Docker fixture builds a small Fieldnotes HTML app, documentation and Python unittest; independent tools overlap, refusal text is retained as a failed turn, and the refusal is not retried automatically.
- Packaged accessibility checks: no reported axe violations in onboarding, welcome, settings, themes and 150% reduced-motion checks; keyboard focus restoration passes.
- Packaged history/recovery checks: missing Linux pipe classified as dependency availability, scroll checks at 100/150/200% in all themes, offline worker loading, search, pagination and cache rebuilding pass.
- Files & skills rendered checks: no composer growth or picker overflow; dark/light/system, 100/150/200%, compact sheet, Escape and focus restoration pass. Screenshots were visually inspected at normal and enlarged scale.
- Live Hindsight/Codex check in a disposable profile: model verification, private Docker service, automatic retention, timeline summary with event citations, cross-project recall with original source attribution, reflection, forgetting, disable and service recovery pass. A verified database/metadata export was restored into a new volume; consent was cleared, and recall passed after explicit destination re-verification. This live recovery round trip used the development build with the final maintenance barrier; packaged memory/settings and worker checks are separate. The profile's measured snapshot before restoration was 30 requests, 62,025 input tokens and 2,886 output tokens across repeated fixture runs. These are fixture-profile records, not account totals or a per-task cost comparison.
- The final package queried the installed Codex CLI successfully and received 10 catalog models. Catalog membership is not a guarantee that every listed model accepts this account's inference requests.
- Current payload audit: 1,135 files, 207 production dependencies, comparisons against 7 local credential values, zero hits. Earlier reachable-history audit: 1,618 blobs, zero hits; no new commit was made by the bug hunt. No new runtime dependency or model weight is bundled. These checks are evidence for the inspected payload/history, not a guarantee against every possible secret format.

## Bug-hunt fixes and coverage

- Project containers now use an init process: the cancellation regression exposed orphaned child processes when it was absent.
- Hindsight waits for PostgreSQL's final TCP server. The earlier Unix-socket readiness check could succeed against the temporary initialization server immediately before it shut down; a fresh live runtime reproduced the failure and passed after the fix.
- Maintenance blocks new timeline work and waits for outstanding observers before closing caches, exporting, or restoring data. A regression and the live recovery round trip cover the ordering.
- Timeline paging now advances from the first visible row. The previous 12-row display over a 60-row backend window skipped records; a 155-event regression checks every row exactly once.
- Failed attachment selection preserves composer text. Compact navigation retains its new-session icon after adding animated button surfaces.

The review followed coordinator/provider, questions/approvals, memory, queue/restart, recovery/checkpoint/worktree, worker-cache, credential, and asynchronous UI boundaries. Existing suites remained green; this is not a claim that all possible defects were eliminated.

## Measurements

100,000 events across 100 sessions, actual one-writer/two-reader SQLite workers:

| Metric | Observed |
| --- | ---: |
| Index build | 13,871 ms |
| Cold SQLite search | 94.19 ms |
| Warm SQLite search, median | 1.43 ms |
| History page, median | 3.20 ms |
| Event-loop p95 / maximum | 19.53 / 22.32 ms |
| Peak process RSS | 212.8 MiB |

The history fixture includes creation, the older JSONL comparison and tests in the same process; it is not an isolated renderer or memory-service measurement. The final packaged coding fixture observed 1,218 ms of tool overlap.

Bridge measurements, 12 runs per image:

| Conditions | Task, median | Steering acknowledgement, median | Tool overlap, median |
| --- | ---: | ---: | ---: |
| 1.0.0, no background indexing | 441.07 ms | 1.93 ms | 289 ms |
| 1.0.1, no background indexing | 435.58 ms | 2.16 ms | 288 ms |
| 1.0.0, separate baseline for indexing run | 438.00 ms | 1.95 ms | 305 ms |
| 1.0.1, concurrent 100,000-event indexing | 480.75 ms | 2.01 ms | 301 ms |

The matched-load timings are observations, not a claimed speedup. The last two rows have different indexing loads, so their task-duration difference cannot be attributed to the code change alone. Fake-clock scheduling tests establish the 20-second per-conversation cadence, two global slots, coalescing, and idle suppression; live inference also produced cited summaries. The live profile separately recorded **4 timeline analyses using 1,282 input and 267 output tokens**. This is added observer usage relative to 1.0.0's absence of an observer, measured over repeated synthetic runs rather than a standard per-task overhead. No token savings or provider latency improvement is inferred. An isolated, matched-task memory-service overhead benchmark remains unmeasured.

## Final package reports

All paths below are local disposable test profiles under `%TEMP%`:

- `unrealcode-101-qa-NSycML/report.json`: latest bug-hunt package; Docker coding workflow and Python unittest, parallel tools (1,227 ms observed overlap), refusal recovery, disabled-memory factual timeline, Codex catalog, and theme/scaling picker checks passed with zero page errors.
- `unrealcode-history-ui-0wwJ7d`: latest packaged offline worker/search/pagination, missing-pipe recovery, and scroll preservation checks passed with zero page or console errors.
- `unrealcode-101-qa-9zouby/report.json`: final palette package; Docker workflow, picker, 28 contrast checks, native control themes, refusal recovery including Edit request focus, and live Codex catalog. Independent tools overlapped by 1,215 ms in this final run.
- `unrealcode-history-ui-gOjGwA`: final offline/history/recovery worker checks; zero page errors or console issues.
- `unrealcode-accessibility-OhSWkY`: final axe/layout/keyboard checks; zero reported violations.
- `unrealcode-qa-D63WLy`: final missing-Docker and encrypted credential fixture.
- `unrealcode-memory-qa-7fSVkF/report.json`: live memory and database restoration round trip.

## Limits

Tests run offscreen in isolated profiles; they do not verify native window placement on virtual desktop 2. No fresh-machine installation, signed installer, update signing, or GitHub attestation is claimed for this local candidate. Live checks used the existing Codex login; other provider rejection cases use synthetic fixtures. No additional confirmed defect remains open from the reproductions above. Broader live-account coverage and the unmeasured memory-service comparison remain acceptance limitations. The previously published v1.0.0 remains unchanged.

## Reproduce

From `desktop/`, run `npm test`, `npm run typecheck`, and `npm run build:release:unsigned -- --output=dist-1.0.1`. Set `UNREALCODE_QA_EXECUTABLE` to the unpacked candidate before running `qa-release101.mjs`, `qa-accessibility.mjs --packaged`, `qa-history-recovery.mjs --packaged`, and `qa.mjs --no-docker --credentials --packaged`.

The explicitly live `qa-hindsight.mjs --live` uses a disposable profile and the existing Codex login; `--recovery` adds the export/restore round trip. Its executable override is `UNREAL_QA_EXECUTABLE`. It does not read or mutate user project content. The 100,000-event benchmark is enabled with `UNREAL_HISTORY_BENCHMARK=1` for `history-cache.benchmark.test.ts`.
