# UnrealCode 0.8.0

- MCP connections for remote HTTP, Windows stdio and project-container stdio.
- Project grants, scoped encrypted credentials, OAuth/PKCE, explicit external
  operation approvals, cancellation and replay protection. Sampling is disabled.
- Selective tool discovery, incremental local repository retrieval, file/skill
  attachments and a context inspector.
- Versioned, reversible context summaries and opt-in compaction at a verified
  context limit, with original events and measured usage retained.
- GitHub issue/review intake, PR checks and selected logs, and commit-bound
  previews for remote actions.
- More reliable metadata replacement during temporary Windows sharing locks.

Local verification: 72 desktop tests, a private-key scanner regression, TypeScript,
full Go race tests and vet, three Python worker tests, backend capability checks,
and packaged Electron/Docker connections, coding, workflow and diagnostics checks.
Light/dark and reduced-motion views were checked through offscreen rendering;
native window placement/chrome was not revalidated in this release.
The existing Codex subscription login passed a live native-file read in Plan mode.

Credential/redistribution audit found no matches to local credentials or secret
patterns. 198 production npm notices are included. Dependency test fixtures are
excluded. The unsigned Windows x64 installer requires Docker Desktop. Hosted CI
remains unverified because account billing/spending limits blocked its runners.

Installer SHA-256:
`37119CF34DF53930663B7076F8C241CD9165F8484F0DD9809BE57A015668B28A`.

Performance observations and validation limits are recorded in ROADMAP_STATUS.md.
