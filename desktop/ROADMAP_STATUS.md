# Roadmap implementation checkpoint

Active checkout: `I:\UnrealCode`; private origin: `MCShotty/UnrealCode`.

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
