# UnrealCode live workflow and feature sweep — 2026-09-27

## Scope

Tested a local unsigned packaged Windows build on virtual desktop 2. Work remained local in `I:\UnrealCode`; no push, publication, installer installation, or remote GitHub write was performed. The existing worktree changes were preserved. The agent's coding task used only a disposable project at `C:\Users\CaptainMcShotgun\AppData\Local\Temp\unrealcode-real-2026-09-27_13-40-07.716Z`.

## Real coding workflow

- Selected and trusted the disposable project, enabled project-specific TypeSafe consent, selected Codex subscription / `gpt-6-astra` / Agent mode, and asked for an offline Python standard-library SQLite issue tracker named Fieldnotes.
- The app executed 16 visible tools: ListFiles (3), ReadFile (4), ApplyPatch (2), DecisionBatch (2), and Bash (5). It generated a package, tests, and usage documentation. Its own run and an independent Docker rerun each passed 17 `unittest` tests; the independent run treated warnings as errors.
- One early DecisionBatch returned HTTP 422 because the model supplied a prose `criteria` string for Noul. The bridge now normalizes that to instructions without mutating the submitted batch. A packaged synthetic Jev check and an actual follow-up decision in the same chat both passed. The follow-up returned Jev `jev-1.13.0`, Noul probability 0.14, and 403 ms latency.
- App-reported project usage at observation: 112,103 input, 8,001 output, 75,136 cached, 133 reasoning tokens, 17 model responses, plus 1,373 decision input and 136 decision output tokens. The Codex subscription limit card showed 22% used in its displayed window. These are measured/reporting values, not costs or organization totals.
- The terminal initially failed with `File not found:` despite a working backend. The desktop now resolves the absolute Docker executable across PATH entries before starting node-pty. The final visible packaged build showed an interactive `/workspace` prompt.

## Feature coverage

- Inspected all 14 navigation destinations: Projects, Chat, Workflow, Review, Sessions, Files, Skills, Usage, Diagnostics, Connections, Context, GitHub, Settings, Terminal. Inspected Workflow's queue, context, provider handoff, search, and saved workflows.
- Inspected File, Edit, View, and Window native menu contents. Standard clipboard, zoom, fullscreen, devtools, and minimize commands were not each invoked.
- Exercised command palette and theme commands, panel toggles, focus layout, session replay, source editor, usage view, decision trace, and the real terminal. Restored Dark theme and standard layout.
- Passed offscreen feature suites for branding and Follow Windows, accessibility, UI races, offline history/recovery, coding modes/editor/worktrees, task workflows, MCP connection transports, team workers, verification loops, recovery, model diagnostics, GitHub local actions, skills, credentials, and reduced motion. The opt-in two-arm decision evaluation completed with fake main-model fixtures and real Jev; both arms passed their test. Its decision-enabled arm took about 4.69 s versus 3.58 s without decisions, so this sample shows no latency saving.

## Verification

- Desktop typecheck passed; desktop unit suite: 174 passed, 2 skipped.
- Go desktop bridge tests passed in `golang:1.27.1-trixie` with `/workspace` created for an existing shell-cancellation test.
- Final packaged terminal roundtrip passed with Docker deliberately placed last in PATH. Live packaged synthetic Jev request passed. `git diff --check` passed.
- Final local unsigned installer: `I:\UnrealCode\desktop\dist-terminal-pathfix\UnrealCode-Setup-1.0.0-preview.1.exe` (SHA-256 `5BB26C330FEB1880CFDAF5C2C0EDB08170AFED841A99E949E637AEF765A82A38`). Unpacked executable SHA-256: `7C106C7906559A5748F171FE20B1F4060AC509BA79905E0AAFCC6A2A47964FEB`.

## Open findings and coverage limits

- The coding chat was marked failed after the early DecisionBatch 422 even though the main coding answer and tests succeeded. After restart, it appeared as stopped. `session.list` currently defaults inactive sessions to stopped rather than replaying their final event status. This remains open; the underlying conversation and tool events replayed.
- The activity rail presented some operations as `remote_job` instead of their tool names, and some short operation durations rounded to 0.0 s. This needs closer telemetry/UI review.
- Claude API, OpenAI API, LM Studio, and third-party MCP accounts were not live-tested without their applicable credentials/runtime. MCP transport coverage used local fixtures. Admin organization usage was unavailable. Remote GitHub pushes/PRs were intentionally not submitted. Signing, update verification, fresh-machine installation, and every native menu action remain untested.
- The final artifact is an unsigned **local test build**, not a release readiness or redistribution claim.
