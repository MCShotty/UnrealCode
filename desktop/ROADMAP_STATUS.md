# Roadmap implementation checkpoint

> Current patch verification and local candidate digest: [WORK_IN_PROGRESS.md](WORK_IN_PROGRESS.md). Feature implementation: [PARITY_IMPLEMENTATION.md](PARITY_IMPLEMENTATION.md). Counts, hashes and release notes below are historical snapshots.

Active checkout: `I:\UnrealCode`; private origin: `MCShotty/UnrealCode`.

## 1.0 preview — local only

User instruction: **do not push or publish 1.0 yet**. No 1.0 GitHub release or
visibility change is authorized. Features and limits: RELEASE_1.0_PREVIEW.md.

Version: `1.0.0-preview.1`. Installer:
`desktop/dist/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256: `47001949E60DB01E55D2D2E6AB4998A710669E5371FB4F08358B171035C32C56`.

Latest local bug-hunt follow-up: 105 desktop tests, TypeScript, Go race/vet and three Python tests passed. The rebuilt package passed coding, recovery, light/dark/system branding and accessibility checks; its credential/dependency audit scanned 918 files/artifacts and 212 production packages with zero secret matches. Flat UC brand assets, a rewritten product README, root AGENTS.md, and recovery/workspace fixes are ready locally. Details are in WORK_IN_PROGRESS.md. Nothing was committed or pushed.

### Earlier preview acceptance (historical baseline)

Local acceptance: 99 desktop tests; TypeScript; full Go race suite and vet, with
the bridge race suite repeated after the latest-history capability; three Python
worker tests and private-key scanner regression. Packaged fixtures passed recovery,
damaged-profile preservation, 3,500-event history replay, archived worktree restore,
editor conflicts/unsaved buffers/search, execution modes, parallel teams, queue
cancellation, verification repair bounds, MCP transports, compaction, retrieval,
workflow, handoff, local search and diagnostics. Final rebuild repeated recovery
and coding checks. Reopening the latest 3,000 fixture events took 546 ms.
The final backend comparison against 0.6.1 measured median task 371.8 → 371.4 ms,
steering acknowledgement 1.76 → 1.75 ms and independent-tool overlap 276 → 277 ms
(12 synthetic runs each; no real-task savings claim). Required capabilities passed
for `unrealcode:1.0.0-preview.1-f79c10fee166`.

Automated WCAG A/AA checks passed on setup and dark/light Settings, including
150% scaling and reduced motion; keyboard close/focus restoration passed. This
does not establish full assistive-technology coverage. The final UI checks were
offscreen. Native desktop placement/chrome and fresh-machine install/upgrade
remain unverified. Valid publisher signing and live signed-update installation
are external prerequisites for stable 1.0. The installer is unsigned and its
update controls deliberately remain unavailable.

Source/payload audit: 905 files/artifacts, 212 reviewed production npm packages,
seven local credential values compared privately, zero hits. Dev-only testing
and build dependencies are checked for exclusion from the packaged application.
The reachable-history and retained-release-asset checks are recorded in the
preview notes; no 1.0 artifacts were uploaded.

Jev 1.13.0 supported the fresh-volume restore, publisher recheck and rollback
claims (confidence 0.90/0.97/0.95). Its vault-exclusion/permission-reset judgments
were uncertain; those properties were established through focused unit and real
Docker recovery checks instead of treating the model output as proof.

## 0.9 teams and verification acceptance

See RELEASE_0.9.0.md for features, exact artifact hash, test counts and limitations.
Packaged team acceptance includes simultaneous isolated workers, inherited Plan
restrictions, independent cancellation, conflicting edits, reviewed integration,
usage aggregation, queued specialist cancellation, restart and request limits.
Verification acceptance includes exact native command previews, three failed
checks/two repairs, cancellation, and Plan-mode refusal. Full Go race tests cover
command replay after restart and cancellation of a running process group.

The synthetic backend comparison used `0.9.0-d197e9e4735b` and baseline
`0.6.1-dee18e0eec60`. Parallel tool overlap and live steering were preserved.
Jev 1.13.0 supported bounded repair-loop behavior (confidence 0.95); its lower
confidence worker-permission judgments were supplemented by focused Go tests,
real Docker checks and a live Codex specialist. No claim relies on Jev alone.

Hosted Actions run 36262688853 did not start either job because account billing
blocked runners. Stable 1.0 still requires signing and fresh-machine acceptance.

## 0.8 connections and context acceptance

Implemented the official-SDK MCP broker for all three execution locations,
project grants, scoped credentials, OAuth/PKCE, operation approval/replay guards,
selective schemas, local repository indexing, context attachments/inspection,
reversible compaction and GitHub task intake with commit-bound remote previews.
Server sampling is refused. In-flight calls retain definitions; tool revocation
cancels affected calls. No connection is silently reactivated after restart.

Verified: 72 desktop tests, private-key scanner regression, TypeScript, the full
Go race suite and vet, three Python worker tests and backend capability checks.
Packaged Electron/Docker checks passed for host/container/HTTP connections,
encrypted server credentials and redacted results, retrieval exclusions,
compaction/continuation/full-history restoration, native coding approvals,
worktree integration, Monaco editing/conflicts/search, per-project queues,
handoff, context, local search, required input, notification routing and diagnostics.
Dark/light and reduced-motion captures were inspected using software offscreen
rendering. Native window placement/chrome was not revalidated; Windows continued
reporting desktop 1 after the user's desktop-2 switch, so no visible test window
was opened. No external GitHub comments or reviews were submitted by these tests.
The live Codex subscription check passed using the existing external login and
native ReadFile in Plan mode. Other main-model providers were not live-tested.

Synthetic bridge comparison, 12 runs each against 0.6.1: median task 419.6 ms
versus 406.7 ms, steering acknowledgement 1.21 ms versus 1.19 ms, and independent
tool overlap 272 ms versus 269 ms. Both tools sleep for 250 ms. These observations
exclude desktop rendering, indexing and snapshots and do not establish real-task
speed gains or token savings. Candidate backend: `0.8.0-c1762b852680`.

Credential/package gate: 612 files/artifacts at final-package audit,
zero matches, five local credential values compared without printing them, and
198 production npm notices checked. Dependency test fixtures are excluded.
The PEM rule now requires key material; generated-key and escaped-key regressions
pass. Jev 1.13.0's focused semantic review supported the parser/header finding
(confidence 0.99) and scanner-test coverage (0.97); it is supplementary evidence.
Official MCP SDK and Ajv are MIT; added BSD-2/BSD-3 dependencies include notices.

Installer SHA-256:
`37119CF34DF53930663B7076F8C241CD9165F8484F0DD9809BE57A015668B28A`.
The 0.x installer remains unsigned. Hosted Actions remain unverified after
account billing/spending limits blocked runner startup.

## 0.6.1 stabilization

Bug-hunt fixes cover queue/message races, provider tool histories, GitHub origin
targeting and partial-load UI, evaluation binary retention, worker cancellation,
conversation event isolation and minimum window sizing. See RELEASE_0.6.1.md.

Verified 53 desktop tests, TypeScript, full Go race suite and vet, three Python
worker tests, packaged Docker/Electron workflow and diagnostics, light/dark and
reduced-motion navigation, encrypted key storage, instructions and terminal.
Secret/package audit: zero matches, 554 files/artifacts, 96 production npm notices.
Installer SHA-256: `F2B3B18409E802E0495F167F66124DF2EE06609BF449D14C23E3F5F3C4CF1EBF`.
Installer remains unsigned. No new live-provider claims.

## 0.7 coding controls and workspace acceptance

Implemented Plan/Ask/Agent modes, one-time operation approvals, native file tools,
reviewed dirty-worktree snapshots, selective integration with recovery copies,
isolated queue review pauses, and a bundled Monaco editor. History selection does
not resume interrupted work. Unsupported captured files keep integration in review.
Windows CI covers desktop compilation, tests, packaging and backend capabilities.

Verified locally: 59 desktop tests, TypeScript, full Go race suite and vet, three
Python worker tests, packaged Docker/Electron coding controls, isolated integration,
editor conflict handling and unsaved buffers, queue/handoff/context/search,
diagnostics, light/dark/reduced motion. A live Codex subscription check used the
existing external login to read a fixture file through ReadFile in Plan mode.
Claude API and additional local runtimes were not live-tested for this release.

Synthetic bridge-only comparison against 0.6.1 (12 runs per build, two parallel
250 ms tools and live steering): median task time 439.7 ms versus 459.7 ms (+4.5%),
steering acknowledgement 2.00 ms versus 1.78 ms, tool overlap 284 ms versus 306 ms.
These fixture observations exclude editor rendering and workspace snapshot setup;
they establish neither production speed gains nor token savings. All parallel
tools and live-steering checks passed. Installer remains unsigned for this 0.x release.

Credential/redistribution audit: 578 files/artifacts scanned, zero secret matches,
100 production npm notices checked. DOMPurify is distributed under its offered
Apache-2.0 alternative; Monaco's third-party notices are included.
Installer SHA-256:
`A020EEF50DF8E23F5E2A45BAAC00138C9AE08D656F8AEC02221B58D86B1FA9D3`.
Packaged coding acceptance passed on this rebuilt installer. GitHub Actions run
36222574008 did not start either job because account billing/spending limits blocked
runners. Hosted CI remains unverified; local Windows/Docker acceptance passed.

## Released 0.4

Commit `0333306b1f452ac30ed213962c15f98918c6b7dd`, published as v0.4.0.
Installer SHA-256: `29b761bb78449da11dfc474ddad325ca71553fe356b75e0a23ba77009ea7ba30`.
Includes system/light/dark themes, panel layout controls, command palette,
reading-position preservation, review workspace, checkpoints, conflict-aware
selective restore and recovery copies. Parallel tool scheduling is preserved.

Verified: 28 desktop tests, TypeScript, full Go source-package suite in Docker,
targeted race checks, packaged fake-provider editing/review/restore/theme/layout/
scroll checks. Credential and dependency audit: zero secret hits, 96 reviewed
production npm dependencies. Installer is unsigned.

## Released 0.5

Commit `14c8858`, published as v0.5.0.

Integrated per-project bridge runtimes, persistent task queues, selected context
and retrieval exclusions, required-input tool, linked manual provider handoff,
optional native notifications, incremental local search, and Workflow UI.
41 desktop tests pass. TypeScript and focused bridge tests pass. Packaged Docker/Electron workflow and theme/review regressions passed.
Targeted bridge/coordinator race checks passed. Credential/license audit: 536
files and artifacts scanned, zero secret matches, 96 production packages checked.
Installer SHA-256: `6DBF0047DB06D2554FF473551EDA0DC2D7EE747C42389BF4FE7AAA1A78C23F1B`.

## 0.6 diagnostics and evaluation

Implemented local model health, detailed decision traces and explicit user notes,
and opt-in paired evaluation in disposable worktrees. Evaluation inputs use a
fixed committed revision, provider/model and task/criteria. Reports preserve tests,
diffs, measured usage and decision evidence separately from ordinary sessions.
Cancellation and restart never automatically start another run. Cleanup is scoped
to owned worktrees and evaluation-only Docker volumes. Uncaptured files and
incomplete usage recovery retain their storage for inspection.

Post-change decisions run on coordinator idle rather than a provider-specific
final-answer phase. A regression test checks tool completion without that phase.

Verification: 48 desktop tests, TypeScript, Go source-package suite, targeted
bridge/coordinator race checks, packaged Docker/Electron paired evaluation,
trace/override, health, queue, handoff, search, notification routing, review/restore,
theme/layout and reduced-motion checks. Synthetic evaluations used a fixture main
model and live Jev; live Laya/Ollama execution remains unverified. No real user
project benchmark was started. Installer remains unsigned.

Final installer SHA-256:
`DF068787A0269DCCFC258D9DF759DEEF79B4CA5E848EB8AF780B74E959316170`.
Credential/dependency audit: 549 files/artifacts, zero secret matches, 96 production
npm package notices verified. No new dependencies were added.

Local performance observations: 1,000 search events queued in 2.31 ms, persisted
asynchronously in 1.34 s, and searched in 14.0 ms (200-result limit). The final small
project checkpoint capture took 166 ms. These fixture measurements are not claims
of workload savings. Tool scheduling and live steering remain independent of
asynchronous index persistence and decision telemetry.
