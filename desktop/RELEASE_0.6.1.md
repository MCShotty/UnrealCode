# UnrealCode 0.6.1

Reliability fixes ahead of the 0.7–1.0 roadmap:

- Queued tasks are reselected after asynchronous readiness checks, so removed or
  reordered tasks do not start from stale queue state.
- Duplicate message retries no longer answer a pending user-input request.
- GitHub pull-request operations explicitly target the selected repository's
  origin instead of an inherited upstream/default `gh` repository.
- Evaluation worktrees with binary changes are retained when their recovery diff
  cannot capture those changes.
- Claude and OpenAI-compatible histories correctly order steering and parallel
  tool replies, including delayed results and images.
- Local decision-worker cancellation and JSONL output handling are more robust.
- Switching conversations clears buffered events from the previous conversation.
- The minimum window size keeps the composer controls within the visible area.
- GitHub connection status remains visible when repository lookups fail, including
  when opening a project that is not a Git repository.

Verification: 53 desktop tests, TypeScript, full Go race suite, Go vet and three
Python worker tests. Packaged Windows/Docker workflow and UI smoke checks use
fixture providers; this release does not claim new live-provider verification.

The installer remains unsigned and requires Docker Desktop's Linux engine.
Credential and redistribution checks found no secret matches in 554 scanned
source/package files and verified notices for 96 production npm dependencies.

Installer SHA-256:
`F2B3B18409E802E0495F167F66124DF2EE06609BF449D14C23E3F5F3C4CF1EBF`
