# Active roadmap work

The canonical checkout is `I:\UnrealCode`, branch `codex/desktop-roadmap`.

## Published

- 0.6.1: `7a8dde2`, tag/release `v0.6.1`.
- 0.7.0: implementation `f4f385b`, evidence `abd40f4`, tag/release `v0.7.0`.
  Installer SHA-256: `A020EEF50DF8E23F5E2A45BAAC00138C9AE08D656F8AEC02221B58D86B1FA9D3`.

## 0.8 accepted locally

Implemented MCP connections for remote HTTP, Windows stdio and Docker stdio,
project grants, encrypted connection credentials, OAuth/PKCE, host approvals and
replay journal, selective schemas, repository index/retrieval, reversible context
summaries, opt-in automatic compaction, context/composer UI, GitHub intake and
commit-bound remote action previews. Acceptance evidence is in ROADMAP_STATUS.md.

Verified before packaging: full Go race suite and vet, TypeScript, 72 desktop
tests. Desktop/Docker fixture checks passed all three MCP transports, credential
redaction, compaction/reversal and retrieval exclusions. OAuth and sampling refusal
have focused protocol tests. Native Windows sharing violations caused intermittent
evaluation report failures; `atomic-metadata.ts` now retries replacement while
preserving old metadata, with explicit regression tests. The whole desktop suite
passed after this fix.

Packaged connections/coding/workflow/diagnostics, light/dark/reduced-motion
captures, live Codex, audit and bridge benchmark passed. Final installer SHA-256:
`37119CF34DF53930663B7076F8C241CD9165F8484F0DD9809BE57A015668B28A`.
Next: commit/publish 0.8, then implement 0.9 and 1.0. No 0.9 implementation yet.

## Current user environment requirement

Use **virtual desktop 2** for the app and any other windows. The user replied Ready,
but Windows still reports desktop 1 of 2. Computer Use has no desktop-switching
API and prohibits Windows-key shortcuts. All subsequent QA used software offscreen
rendering (`UNREAL_DESKTOP_BACKGROUND_CHECK=1` with isolated test user data), so
no visible test windows opened. Native window placement remains unverified.

## External prerequisites

GitHub-hosted Actions did not start because the account billing/spending limit
blocked runners (run 36222574008). Local Windows/Docker gates remain usable.
No Windows signing credential was found. The earlier signing-method question is
still pending. Stable 1.0 remains gated on signing; an unsigned build is not stable
1.0 acceptance.

## 0.9 implementation direction

Add a main-process task/team controller with explicit per-task opt-in, default two
workers, at most four per task and four globally, and no nested delegation. Worker
roles inherit the provider and restrictions; explorers/reviewers use Plan mode.
Persist worker relationships and limits in app data, and use linked fresh sessions
in worktrees from a recorded parent checkpoint, showing the checkpoint version.
Never snapshot files while concurrent parent tools are writing; use the most recent
completed checkpoint, or the current turn's captured before-state.

Reuse checkpoint/worktree integration for explicit user review. Hold the project
queue while workers run or their changes await integration. Keep original branches
and evidence, and allow per-worker steering, cancellation and stop-all. Restarts
show interrupted teams and require explicit resumption.

Reserve worker slots before async creation. Gate logical model requests in main
before dispatch when task limits are enabled; accumulate provider-reported parent
and worker usage without inherited-history double counting. Token gates permit
in-flight overrun and must label that limitation. Add user-editable review/test/fix
templates and verification profiles; repair loops stop after two unsuccessful
attempts by default and retain results.
