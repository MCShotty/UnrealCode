# Roadmap implementation checkpoint

Active checkout: `I:\UnrealCode`; private origin: `MCShotty/UnrealCode`.

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

## Verified 0.5

Integrated per-project bridge runtimes, persistent task queues, selected context
and retrieval exclusions, required-input tool, linked manual provider handoff,
optional native notifications, incremental local search, and Workflow UI.
41 desktop tests pass. TypeScript and focused bridge tests pass. Packaged Docker/Electron workflow and theme/review regressions passed.
Targeted bridge/coordinator race checks passed. Credential/license audit: 536
files and artifacts scanned, zero secret matches, 96 production packages checked.
Installer SHA-256: `6DBF0047DB06D2554FF473551EDA0DC2D7EE747C42389BF4FE7AAA1A78C23F1B`.

## 0.6 remaining

Local-model health, richer decision traces, and opt-in paired evaluations in
disposable worktrees remain to implement and verify. Repeat packaged checks,
credential and dependency audits before each release.
