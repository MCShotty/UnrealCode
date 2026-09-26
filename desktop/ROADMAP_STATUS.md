# Roadmap implementation checkpoint

Active checkout: `I:\UnrealCode`; private origin: `MCShotty/UnrealCode`.

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
