# UnrealCode 1.0 local preview

**Local only. Do not push or publish this version without a new user instruction.**
The stable 1.0 acceptance gate remains open: signing and fresh-machine installation
have not been verified. Hosted Actions runners remain blocked by account billing.

## Implemented

- Guided setup and actionable provider, Docker and recovery settings.
- Explicit update checks/downloads/restarts, stable and preview channels, installer
  checksum and publisher checks. Unsigned builds keep updates unavailable.
- Same-profile recovery folders with integrity checks, original metadata retained
  before migration/restore, interrupted-transaction recovery, and saved Docker
  sessions imported into fresh volumes. No saved API keys or external logins are
  exported. Trust, cloud consent, MCP grants and execution modes reset on restore.
- Storage inventory, reviewed index/model-cache/older-backup cleanup, and retention
  of unfinished work and the latest recovery copy. Fully integrated task worktrees
  can be archived and restored from captured snapshots; branches/history remain.
  Ignored, uncaptured and later-edited files block worktree removal.
- Previewed support bundles containing versions, runtime health and failure
  categories; raw errors, credentials and project content are excluded.
- Latest-window loading for long chats, bounded model-facing team status, and
  protection of incomplete checkpoints from automatic retention cleanup.
- Settings keyboard focus management, darker light-theme success text, and editor
  workspace selection that waits for the selected task to finish opening.
- Public-source build, contribution and security-reporting documentation, retained
  upstream MIT attribution and expanded dependency notices.

## Verification observations

The full Go race suite and vet and 99 desktop tests passed. The final installer
hash and detailed acceptance evidence are recorded in ROADMAP_STATUS.md. Docker fixtures
cover recovery, specialist teams, verification repair limits, MCP transports,
context, queues, handoff, search and diagnostics. Tests use software offscreen
rendering; native desktop placement and window chrome are not established by them.

Final synthetic bridge comparison, 12 runs against 0.6.1: median task 371.8 → 371.4 ms,
steering acknowledgement 1.76 → 1.75 ms, independent-tool overlap 276 → 277 ms.
This fixture excludes UI, indexing and worktree preparation and does not establish
real-task speed gains or token savings.
Final candidate backend: `unrealcode:1.0.0-preview.1-f79c10fee166`; required
protocol capabilities passed the compatibility check.

Reachable Git history audit: 1,197 blobs (20.5 MB), zero secret matches at the
recorded pre-1.0 HEAD. Retained GitHub 0.3/0.8/0.9 installer hashes matched their
published digests; 476/478/483 extracted files respectively had zero matches.
The final local source and installer payload audit scanned 905 files/artifacts
and compared seven local credential values privately, with zero hits. 212
production npm packages were reviewed; dev-only test/build packages are excluded.

New updater dependencies include specifically reviewed argparse/Python-2.0 and
sax/BlueOak-1.0.0 notices. lazy-val declares MIT in upstream package metadata and
omits a separate license file; its attribution and declared-license provenance are
documented explicitly in third-party-licenses/lazy-val-NOTICE.txt.

Recovery backups are private archives of user conversations and captured files;
they may contain sensitive user-provided content even though credential stores
are excluded. Restore currently requires the original Windows app-data/profile
location and project paths. Cross-machine relocation is not supported.
