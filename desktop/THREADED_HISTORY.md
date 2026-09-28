# Threaded history and storage recovery

Unreal Agent's Docker JSONL logs remain authoritative. UnrealCode maintains a
rebuildable SQLite cache on Windows for session lists, event windows, local
conversation search, changed filenames and synchronization cursors. Chat titles,
session identifiers and backend volume names retain their existing meaning.

## Runtime

- One cache per app profile, under `history-cache/<UTC timestamp>.sqlite`.
- One Node writer/indexing worker and two query workers, with a connection per
  worker. The packaged worker uses Electron's built-in `node:sqlite` and FTS5.
- WAL, short transactional batches, bounded queues and contiguous replay cursors.
  A duplicate event cannot replace an already recorded event. File annotations
  can arrive before their corresponding event. Literal search preserves case in
  displayed snippets and handles code punctuation.
- Database access and text extraction run in workers. Active tools deliver live
  events without awaiting cache writes. Overflow is recovered from the canonical
  bridge log on the next synchronization.
- Superseded view/search requests mark their queued worker jobs cancelled. The
  renderer also guards against applying a response to another selected session.
- Previously cached history is available offline, with synchronization status and
  older-event navigation. Initial loading of an uncached session still needs
  Docker. The backend's existing JSONL replay API is unchanged.
- Workers transfer no provider credential objects. The database contains local
  conversation content and is not an encrypted vault. It is excluded from normal
  recovery backups and can be rebuilt; credentials keep their existing main-process
  encrypted storage.

## Storage naming and migration

Physical folders use names such as `2026-09-27_18-42-10.123Z`, with a numeric
suffix for a collision. Location registries separate physical paths from stable
logical identities. Fixed metadata filenames and integrity/deduplication hashes
remain functional identifiers.

Startup migration inventories existing Electron workspace/checkpoint/specialist
folders, registered task worktrees, and completed recovery directories. It makes
and verifies a private recovery backup before relocating data. Git worktrees
move through Git, using temporary staging while their containing directories
move. File inventories include dirty, untracked and ignored files. Metadata path
references and volume-registry project paths follow the move; volume names do not.

`storage-migration.json` journals relocation and metadata changes. Interrupted
work is rolled back before another attempt. Locked worktrees, submodules,
embedded repositories, links and inaccessible registrations block unsafe moves
with recoverable prior data. The completed layout marker and migration backup
are retained. Restore accepts legacy recovery layouts; cache data is quarantined
and regenerated after restoration.

## Failures and interface

The main process returns plain structured IPC envelopes. The renderer creates
its own errors after crossing contextBridge, because Electron strips custom Error
properties at that boundary. Failure notices carry a code, affected feature,
recovery actions, redacted details and a support reference.

Missing Docker, unavailable Linux engine pipes and wrong container mode are
dependency failures. A migration awaiting its Docker backup does not mark saved
metadata damaged. Safe settings and cached history remain accessible. Mutating
agent actions remain unavailable until the required runtime and migration are
ready. Retrying checks does not replay uncertain commands or provider requests.

Welcome, onboarding and recovery screens have explicit scroll containers.
Native scrolling retains keyboard/wheel/touchpad behavior. Shared theme colors
style ordinary, Monaco and terminal scrollbars; forced colors and reduced motion
retain their system behavior.

## Reproduce focused checks

From `desktop/`:

```powershell
npm run typecheck
npm test
$env:UNREAL_HISTORY_BENCHMARK = '1'
npm test -- src/main/history-cache.benchmark.test.ts
Remove-Item Env:UNREAL_HISTORY_BENCHMARK
$env:NODE_OPTIONS = (($env:NODE_OPTIONS + ' --use-system-ca').Trim())
npm run build:win
node scripts/qa-history-recovery.mjs --packaged
node scripts/qa-recovery.mjs --packaged
node scripts/qa-accessibility.mjs --packaged
```

`qa-history-recovery` uses a disposable profile and a deliberately missing Docker
pipe, while leaving the host daemon alone. It checks packaged worker loading,
offline history/search/pagination and welcome scrolling at 100%, 150% and 200%
scaling. The existing recovery fixture checks real Docker session export/import.

`benchmark-bridge.mjs <baseline-image> <candidate-image> --history-cache` adds a
100,000-event SQLite writer and two search workers during its candidate run. Its
measurements cover synthetic tools and steering, not model quality, provider
token savings, renderer cost, or first-time canonical-log replay.

All builds remain local. The 1.0 publication hold is unchanged.
