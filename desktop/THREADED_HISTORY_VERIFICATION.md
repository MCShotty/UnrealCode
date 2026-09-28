# Threaded history verification - 2026-09-27

> Historical verification of the initial implementation. See [DEEP_BUG_HUNT_2026-09-27.md](DEEP_BUG_HUNT_2026-09-27.md) for subsequent fixes, current checks, and the replacement installer checksum.

The local Windows preview implements the Electron SQLite cache, timestamp storage
locations with migration, structured recovery, and themed scrolling. Canonical
Unreal Agent JSONL storage remains unchanged by this work. Prior unrelated edits
were preserved. No commit, push, tag, release upload or visibility change was made.

## Checks

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Desktop suite | 137 passed; optional benchmark skipped in normal suite and run separately |
| SQLite | Actual writer and two reader threads; concurrent reads/writes, literal search, cursor gaps, replay, locks, worker death, interrupted transaction, corruption/rebuild, pagination and restart passed |
| Storage migration | Dirty/untracked/ignored worktrees, absent archived tasks, inferred legacy volumes, rollback, timestamp collisions and junction rejection passed |
| Packaged offline UI | Missing Linux pipe leaves migration pending; history/search/pagination work offline; structured errors survive preload; reading position is preserved |
| Scrollbars | Dark/light/system themes at 100%, 150% and 200% zoom passed; welcome overflow and 12-pixel scrollbar verified |
| Packaged recovery | Real Docker backup/export/restore, long history, credentials excluded, trust reset and stopped sessions after restart passed |
| Packaged coding | Ask approvals, isolated snapshots, integration, archive/restore, editor saves/search/conflicts, selection-to-chat and Plan mode passed |
| Accessibility | No reported Axe violations in tested onboarding/settings states; reduced motion, 150% zoom and focus restoration passed |
| Redistribution/credentials | 936 files/artifacts and 212 production packages checked; 7 local credential values compared privately; no hits |
| Installer | Built locally; unsigned; publishing disabled |

Playwright's Electron support was used with disposable, offscreen profiles.
The Browser plugin was unavailable. No visible test windows were opened on another
virtual desktop. These checks do not establish fresh-machine installation,
signed updates, native window chrome or full screen-reader coverage.

## Measured performance

Electron 44.4.5, bundled SQLite 3.53.4; 100,000 synthetic events in 100 sessions:

| Measurement | Previous JSONL index | SQLite cache |
| --- | ---: | ---: |
| First search after reopening the index service | 165.85 ms | 85.19 ms |
| Warm search, median of 20 | 8.78 ms | 1.64 ms |
| Cached 500-event history page, median | Not compared | 2.56 ms |

Cache construction took 12.89 seconds. Process peak RSS was 188.77 MiB and main-loop
p95 delay was 19.50 ms. These include fixture creation and both implementations;
they are not isolated app memory or renderer-frame measurements. The first-search
measurement does not represent an OS cold-disk reboot.

A separate 12-run-per-arm fixture used the same Go backend image with and without
concurrent SQLite indexing/search. Median task time was 501.45 / 519.77 ms;
steering acknowledgment was 3.18 / 3.70 ms; independent tool overlap was 313 / 310 ms.
This measures synthetic tool execution during indexing, excluding renderer and
checkpoint setup and initial canonical-log replay. It makes no token-saving claim.

## Evidence

Files are retained under the Windows temporary directory:

- `unrealcode-history-ui-zY7uXG`: final packaged offline, scrollbar, scroll-preservation and IPC checks, with screenshots; no page or console errors.
- `unrealcode-recovery-2n7v0R`: final packaged Docker recovery and long-history checks; no page errors.
- `unrealcode-coding-WTctoi`: final packaged coding workflow; no page errors or warnings.
- `unrealcode-accessibility-I96hRf`: accessibility, reduced-motion and theme checks for the same renderer behavior.
- `unrealcode-history-benchmark-CwUavR`: final 100,000-event cache measurements and actual worker identities.

## Local artifact and activation

Installer: `I:\UnrealCode\desktop\dist\UnrealCode-Setup-1.0.0-preview.1.exe`

SHA-256: `2AC93F731D64213F16065C33DABF61C5C5B5BA0EC767A7CC534BBB79722CF21D`

The real user profile was not migrated by the fixture tests. The updated app
performs its backed-up migration on the next launch, once its prerequisites are
available. Existing long names remain in the untouched profile until that run.
The preserved `I:\UnrealGUI` backup remains outside this implementation.
The 1.0 publication hold remains in effect.
