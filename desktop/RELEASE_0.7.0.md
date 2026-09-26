# UnrealCode 0.7.0

- Plan, Ask and Agent execution modes, with Ask as the new-session default.
- Correlated one-time approvals; stale approvals cannot survive a restart.
- Native bounded reading and revision-checked file editing tools.
- Reviewed task worktrees including dirty local files, conflict-aware integration,
  recovery checkpoints and queue pauses for review.
- A local Monaco editor with tabs, search, diffs, unsaved buffers, safe saves,
  selection-to-chat and an external-editor shortcut.
- Explicit session resumption, mode-safe history replay and backend capability
  negotiation.
- Windows desktop CI and Docker protocol compatibility checks.

Parallel tools and live steering are retained. Approval waiting is reported
separately from execution time. Installer signing remains a prerequisite for
stable 1.0; this 0.x installer is unsigned and requires Docker Desktop.

Release verification and installer digest are recorded in ROADMAP_STATUS.md.

Verified locally: 59 desktop tests, TypeScript, Go race suite and vet, packaged
Windows/Docker coding, workflow and diagnostics checks, and a live native-file
read using an existing Codex subscription login. Credential audit: zero matches;
100 production npm notices included. GitHub-hosted CI could not start because
account billing/spending limits blocked runners; it remains unverified.

Installer SHA-256:
`A020EEF50DF8E23F5E2A45BAAC00138C9AE08D656F8AEC02221B58D86B1FA9D3`.
