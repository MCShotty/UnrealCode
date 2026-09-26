# Active roadmap work

Canonical checkout: I:\UnrealCode, branch codex/desktop-roadmap. I:\UnrealGUI is the backup.

## Current user constraint

**Do not push 1.0 to GitHub yet.** Keep source, commits and installers local.
No 1.0 release or repository visibility change without a new user instruction.
Use virtual desktop 2 for visible windows. All current app tests run offscreen
with isolated profiles; native window placement remains unverified. No subagents.

## Published before the hold

0.9.0: db4b776, tag/release v0.9.0. Its remote installer digest was verified:
E0772E933C14A6F1465F3345C278769E6A7C5231220E38A5D371ECA1A5CDF1D4.
Live GitHub inventory contains 0.3.0, 0.8.0 and 0.9.0. Earlier local tags and
installers exist; do not assume their release entries remain online.

## Local preview

Version 1.0.0-preview.1. Installer:
desktop/dist/UnrealCode-Setup-1.0.0-preview.1.exe
SHA-256: 1E00847D1A081DAD962F0FAE21690FE8CC7DD95B5B67866B13B90F6631C17042.
Features and acceptance details: RELEASE_1.0_PREVIEW.md and ROADMAP_STATUS.md.

Implemented recovery export/import, original metadata backups, transaction rollback,
fresh session-volume restore, authority resets, damaged-profile recovery, explicit
signed-update controls, storage previews/cleanup, integrated-worktree archival and
restore, support previews, setup guidance, latest chat history, bounded team output,
keyboard focus, canonical editor workspace identity and selection guards.

99 desktop tests, TypeScript, full Go race/vet, focused final bridge race, three
Python tests and the scanner regression passed. Packaged recovery/long-history,
coding/archive/editor, accessibility, no-Docker/encrypted-key, team, verification,
connections, workflow and diagnostics fixtures passed. Final rebuild repeated
recovery and coding; latest fixture directories in Temp are unrealcode-recovery-Vf0NyI
and unrealcode-coding-oRJHjP. Final backend: unrealcode:1.0.0-preview.1-f79c10fee166.
Requires history.latest.v1 capability. Backend fingerprint now covers license inputs.

Credential/payload audit: 905 files/artifacts, 212 reviewed production packages,
seven local credential values compared privately, zero hits; dev-only packages
excluded from application. Reachable Git blobs before the local commit: 1197,
zero hits. Retained release installers matched remote digests and their extracted
payloads passed. All audit calls to GitHub were read-only after the hold.

## Limits and remaining acceptance

Stable 1.0 is not signed off. No signing credential is configured. Unsigned builds
keep updates unavailable. Fresh-machine install/upgrade, a real signed update,
full assistive-technology coverage, and native window/chrome checks remain unverified.
Hosted Actions did not start because of account billing/spending limits (36262688853).
The prior signing-method question remains unanswered. Do not ask for a new API key.
Provider login/refresh remains external; latest live Codex evidence is from 0.9.
Recovery import currently requires the original app-data/profile and project paths.

## Build notes

Desktop scripts run from I:\UnrealCode\desktop. Packaging uses system CAs.
build-release.mjs invokes npm dependency discovery through Node because this host's
PowerShell EncodedCommand wrapper can return an empty stream. It retains the real
production/transitive dependency tree. Use npm run build:win; stable signing uses
npm run build:stable with real credentials and UNREALCODE_PUBLISHER.
Model weights, Docker Desktop, external CLIs and test tooling are not bundled.
Dependency notice provenance is documented in third-party-licenses/README.md.
