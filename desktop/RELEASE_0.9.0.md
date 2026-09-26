# UnrealCode 0.9.0

- Optional specialist teams with explicit assignments, recorded-state worktrees,
  separate steering/cancellation, and reviewed integration with recovery copies.
- Two concurrent workers by default, up to four per task and globally; no nested
  delegation. Explorers/reviewers use Plan mode. Worker commands require approval.
- Parent/worker/combined measured usage, worker/request/time/token limits, and
  explicit restart recovery. In-flight usage can exceed a reported-token limit.
- Saved review/test/fix templates, named verification commands, and optional repair
  loops that stop after two unsuccessful repair attempts by default.
- Queue cancellation stops its specialists; unresolved worker changes keep the
  queue paused for review. Tool cards use recorded operation completion states.

Verified locally: 87 desktop tests, TypeScript, full Go race tests and vet, three
Python worker tests, and packaged Windows/Docker team, verification, connections,
coding, workflow, and diagnostic checks. Existing Codex login passed a live
native-file read and a linked specialist read. Other providers were not live-tested.
Offscreen dark/light/reduced-motion checks passed; native window placement and
chrome were not revalidated. Hosted CI runners remain blocked by account billing.

The full unpacked distribution and source passed the credential audit: 875 files
and artifacts, seven local credential values compared privately, zero matches.
198 production npm package notices are included. No new dependencies were added.
The Windows x64 installer requires Docker Desktop and remains unsigned for 0.x.

Installer SHA-256:
`E0772E933C14A6F1465F3345C278769E6A7C5231220E38A5D371ECA1A5CDF1D4`.

Synthetic parallel-tool benchmark against 0.6.1: median task 478.3 → 481.3 ms,
steering acknowledgement 2.52 → 2.63 ms, tool overlap 304 → 305 ms (12 runs each).
These fixture results exclude UI, indexing and worktree preparation and do not
establish real-task speed gains or token savings.
