# Storage and recovery

## Where data lives

| Location | Data |
| --- | --- |
| Project folder or task worktree | Source files and edits. |
| Windows app profile | Settings, encrypted credentials, Fieldnote originals, queues, registries, checkpoints, and recovery metadata. |
| SQLite history cache | Rebuildable search, history, activity, and receipt projections. One writer and two reader workers. |
| Docker volumes | Canonical backend sessions and events. Optional memory uses registered durable volumes. |
| Browser storage | Separate project sign-ins, excluded from ordinary backups and support exports. |

Electron-owned storage uses filesystem-safe UTC date/time names where applicable. Logical session IDs and display titles stay unchanged. Hashes still serve integrity and deduplication.

## Back up or restore

Open **Settings > Recovery**. Export a private backup, preview a restore, and inspect its warnings before applying it. Retained recovery volumes can be inspected, exported, or reattached through ownership-checked actions.

Settle active work and save buffers first. Recovery preserves previous snapshots and checks conflicts instead of silently overwriting later edits. Original Windows profile and project paths are currently required for import.

If backup or migration needs Docker, a missing daemon means waiting for a dependency, not lost conversations. Keep the pending recovery state and retry after Docker starts.

## Cache and cleanup

A corrupt SQLite cache can be rebuilt from authoritative logs and metadata. It is excluded from normal recovery exports; rebuilding does not rerun historical model analysis.

Use the storage preview to remove only items marked removable. Do not guess a volume's owner from its name or manually delete session data to fix an index issue.

Support bundles are separate from backups. Preview their redacted diagnostics before sharing. Recovery backups may contain source and conversations, so keep them private.

## Release notifications

In **Settings > Recovery**, choose Stable or Preview and whether to **Check automatically after startup and once daily**. Checks run quietly, share no project content, and remember the last check across restarts. **Check for updates** works when automatic checking is off.

A newer release gets a dismissible in-app notice. **View release & changelog** opens the project's GitHub release in your system browser. Dismissal is remembered for that version; the release remains accessible in Settings. Stale results and retry times are shown after network failures.

The current unsigned app cannot automatically download, install, or restart for an update. Verify the release and install it manually after saving work and closing UnrealCode.
