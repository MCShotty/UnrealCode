# Accepted 0.7–1.0 implementation roadmap

Canonical checkout: `I:\UnrealCode`; origin: `MCShotty/UnrealCode`.
Windows x64 + Docker Desktop Linux engine. Preserve parallel tools, live steering,
measured usage, existing history, and the global decision-engine setting.

## Release gates

- [x] 0.6.1: package, audit and smoke-test the existing bug-hunt fixes; publish
  the verified installer with the release commit.
- [ ] 0.7: execution modes and correlated approvals; native file tools; isolated
  task workspaces with dirty-file snapshots and conflict-aware integration;
  locally bundled Monaco editor; Windows desktop CI.
- [ ] 0.8: main-process MCP broker for remote HTTP, Windows stdio and Docker
  stdio; explicit server/project grants; focused repository retrieval; versioned
  reversible context summaries; GitHub issue/review intake; context/connections UI.
- [ ] 0.9: explicitly enabled bounded specialist workers in isolated worktrees;
  inherited restrictions; steering/cancellation/integration; verification profiles
  and bounded repair loops; task limits and nonduplicated team usage.
- [ ] 1.0: guided setup, signed NSIS updates, backups/migrations/recovery,
  storage cleanup previews, redacted support exports, public-source audit/docs,
  accessibility and long-session checks.

## Invariants

New sessions default to Ask. Plan enables dedicated reading/search only; arbitrary
shell and third-party tool hints never prove an operation read-only. Approval binds
to a session, workspace, operation, arguments and live request; restart invalidates
pending approvals. Waiting for approval must not block unrelated tools.

New Git tasks default to isolation, with an explicit snapshot review; existing
tasks keep their workspace choice. Include tracked/nonignored local changes, show
omissions, and do not overwrite later edits during integration. Pause isolated
queues for integration review. Top-level queues stay sequential per project.

Delegation and automatic compaction default off. Workers default to two concurrent
per task, at most four, with a global limit of four and no nested delegation.
Workers cannot expand permissions or publish independently. Context compaction
retains raw events and runs only at safe boundaries; the automatic threshold is
80 percent of a verified context limit. Unknown limits require manual compaction.

MCP credentials stay in the main-process store and are disclosed only to the
configured connection. Host MCP processes require separate host-access trust.
Model sampling by MCP servers is disabled. Decision outputs never authorize work.

Every release needs Go/TypeScript/desktop/Docker/packaged Windows checks, secret
and redistribution audits. Compare legacy workflows against 0.6.1. Publication
of stable 1.0 additionally requires signing credentials and fresh-install/upgrade
verification. Do not label an unsigned candidate a completed stable 1.0.

## External prerequisites

No Windows signing certificate or configured signing service was found at kickoff.
A user question is pending; implementation and unsigned candidate verification
can continue independently. Never write private keys or passwords into this file.

## Deferred

Native backend without Docker, macOS/Linux, full IDE/debugger, cloud collaboration,
extension marketplace, and Claude subscription integration remain after 1.0.
