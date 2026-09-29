# UnrealCode Desktop

Windows desktop application built on the [Unreal Agent](https://github.com/unreallabsai/unreal-agent) Go harness. Electron owns credentials, GitHub access, project trust, and preferences. A per-project Docker container runs the Go coordinator and tools; sessions and sequenced events persist in a Docker volume.

## Run

1. Start Docker Desktop with its Linux engine.
2. In `desktop/`, run `npm ci` and `npm run dev`.
3. Choose one global typed-decision engine on first launch: Jev, Laya, or **Set up later**. Settings can change or disable it at any time.
4. Open a project folder and accept the native trust prompt. Only that folder and durable session storage are mounted in the container.
5. Choose a provider in Settings. The default is an existing Codex subscription login from `CODEX_HOME/auth.json` or `~/.codex/auth.json`; Codex refresh remains external. Claude API, OpenAI API, OpenRouter, and Fireworks use API keys. Ollama and private-network OpenAI-compatible Chat Completions servers are supported with model discovery.

Optional app-wide memory is configured under **Settings → Memory**, with or without an open project. Choose its separate provider/model, or copy the chat selection, then verify the model and accept the broader recall scope. Relevant outcomes can be recalled across trusted projects with source attribution; unintegrated specialist findings stay task-scoped. Browse, correct, forget and export records from Memory settings or the Memory workspace. Existing project records migrate after a verified metadata backup and explicit consent, without ingesting all historical chats. The same model can generate bounded, cited timeline summaries; recorded events and coding remain available when it fails.

**Settings → Recovery → Application updates** checks GitHub for release notifications. Stable is the default; Preview is optional. Automatic checks are enabled by default, run when due after startup and once daily, and can be disabled. Manual checks remain available. The private repository listing may use the existing host `gh` login after an anonymous 404; no token goes to Docker or the renderer. **View release & changelog** opens the validated release page; this unsigned app cannot automatically install updates. Existing 1.0.0 users and owners of the earlier private 1.0.1 installer must install the same-version replacement manually.

**Browser** now opens live Electron `WebContentsView` tabs in a separate session per project, even without an active chat. User navigation, sign-in, tabs, page find, zoom and downloads work without agent grants. Main-agent observation and interaction require exact project/origin grants and handing back a tab; a signed-in granted page may be visible to the agent. BrowserDo uses the existing Jev configuration only when Jev is selected globally and project plus web-origin cloud consent are in place. It pursues one observable outcome and returns uncertainty or confirmation needs rather than treating Jev as authority. The older Playwright profile remains available for specialist workers and recovery; cookies are not copied.

**Documents** offers local PDF page rendering, searchable/selectable embedded text, page references, and English/Arabic OCR of selected pages. Built-in `pdf-reading`, `pdf-parsing`, `ocr`, `markdown`, and `browser-use` skills are read-only and app-wide; project `.harness/skills` may extend or override them. Agent document tools read trusted-project PDFs or external PDFs explicitly attached to a chat. OCR language data downloads on demand and is checked against pinned SHA-256 values. Document contents are not automatically sent to memory or a model.

Settings → Recovery lists session volumes retained after an interrupted restore. A copy with a verified Docker ownership label can be exported as private session files for manual recovery. This export is not a full app backup or a direct import format. If the original project folder is accessible and has no existing session mapping, the app can reattach the volume after showing both the recorded and resolved paths for confirmation. Existing mappings are never replaced; older journals without an ownership token remain for manual review.

The app stores provider keys using Electron `safeStorage` when available, otherwise in memory for the current run. It passes keys to the bridge over attached JSONL standard input, never Docker arguments, environment, project files, or persisted session settings. A Claude subscription is not an API credential and is not supported.

Jev reads `TYPESAFE_API_KEY` from the Windows user environment in Electron's main process. Each project requires a separate native consent action before focused project text can be sent to TypeSafe. Laya and GLiNER are optional local workers installed on demand into the session volume. GLiNER extracts entities; it is not a Choice/Noul/Score decision engine. If the selected decision engine is unavailable, the main model can continue without a silent engine switch. Decision answers, probabilities, model version, source references, and measured usage are shown in activity.

GitHub uses the host's installed `git` and authenticated `gh` CLI. The GitHub page supports clone, fetch, pull, worktree creation, staging, commits, pushes, and pull request creation and review. The selected project must be the repository root for mutations.

## Build and verify

```powershell
cd desktop
npm run typecheck
npm test
npm run build:code
npm run build:win
node scripts/qa.mjs --workspace --flows --motion
node scripts/qa.mjs --workspace --flows --packaged
```

The 1.0.1 package produces `dist/UnrealCode-Setup-1.0.1.exe`. Use `npm run build:release:unsigned` for explicit unsigned release packaging and [verify each release](VERIFY_RELEASE.md). The package bundles backend source and builds a Docker image tagged with the app version and source fingerprint, so a rebuilt installer does not reuse an older backend image. No host Go installation is required. Run `node scripts/qa-shared-documents.mjs --packaged` for shared-browser and PDF worker acceptance, and `node scripts/qa-live.mjs --codex` for a live Codex tool call when the existing login is available.

The installer includes third-party license texts in `resources/licenses`, plus Electron and Chromium notices at the application root. `npm run build:win` regenerates npm notices and stops if a new dependency's license needs review. PDF.js, Tesseract.js, native canvas/Skia, language data, and the adapted jev-browser source are covered in the inventory.

On Windows systems with HTTPS inspection, use `$env:NODE_OPTIONS='--use-system-ca'` and a trusted `NODE_EXTRA_CA_CERTS` file for npm and Electron Builder. The backend build receives public Windows system CA certificates as a BuildKit secret. Keep TLS verification enabled.

## Architecture and boundaries

- The Go bridge uses one coordinator per active session, stable message IDs, and a serialized session store. Restart replays persisted events; stop, resume, and fork use Unreal's session model.
- Automatic preflight batches bounded route and risk questions for code-change requests when a selected engine is ready. After a Git change, a second asynchronous batch checks narrow requirement alignment and contradiction signals against the focused diff. The `DecisionBatch` tool handles search relevance and candidate selection over shortlists; `EntityExtract` is separate. The main model still plans, codes, explains, and resolves uncertain results; decision output cannot authorize a tool or Git action.
- Files, skill edits, and GitHub paths are validated against the trusted project root. App-wide built-in skills are packaged read-only; project skills live in `.harness/skills`.
- The Usage screen separates UnrealCode session tokens from optional organization-wide OpenAI and Anthropic usage reports. Each organization report requires its own admin key in Settings; normal model API keys do not grant this access. Reports are refreshed no more than once every five minutes and may lag recent calls.
- With the host Codex CLI and existing ChatGPT login, Usage reads actual subscription percentages and reset times through Codex app-server. It refreshes no more than once per minute. Without the CLI or login, the account card shows an unavailable state; session tokens remain visible.
- Provider response headers show short-window rate-limit headroom separately from account totals. The Usage page reports measured input, output, cached, cache-write, reasoning, and decision tokens without estimated dollar costs. Context percentage appears only when a verified model limit is available.
- The chat activity rail shows overlapping model and tool timings and can cancel one active operation without stopping the session. Telemetry is queued off the coordinator's critical path. The interface honors reduced motion and keeps terminal text stationary.
- An extension/plugin marketplace and a Claude subscription session engine remain outside this release. Reviewed hooks and Agent team subagents are available, with isolated worktrees and reviewed integration; see [the feature overview](../README.md).

## Connections and context (0.8)

Connections supports remote Streamable HTTP, Windows stdio and project-container
stdio servers through the official MCP SDK. Each project grants selected tools,
resources and prompts. Windows servers have host-account access and require an
explicit host trust action. Every external tool call has a separate operation
approval, including Agent mode. Server annotations cannot grant permissions;
server-initiated sampling is disabled. Bearer tokens, server-specific environment
values and OAuth/PKCE credentials stay in the encrypted main-process vault.
OAuth discovery requires server support for dynamic client registration.

FindTools searches the enabled catalog and loads relevant schemas between model
requests. Active definitions retain their identities; revoking a tool cancels its
active calls. Restart requires reconnecting and new approvals. Calls with an
unknown outcome are never automatically repeated.

Context shows selected sources, inclusion reasons, exclusions and measured input
size. RepositorySearch uses an incremental local index and checks excerpt
freshness. The selected decision engine may rank focused excerpts when available
and permitted. Composer file attachments and explicit skill selection are local.
Context summaries preserve original events, record source fingerprints and
measured usage, and can be reversed. Automatic compaction is off by default and
only runs at idle boundaries at 80% of a verified context limit.

GitHub issues and selected PR review comments can become linked queue tasks.
Review displays checks and selected failure logs. Pushes and PR operations show
native previews tied to the exact commit and repository.

For automated offscreen checks, set `UNREAL_DESKTOP_BACKGROUND_CHECK=1`; the
test scripts supply an isolated `UNREAL_DESKTOP_USER_DATA` directory. This mode
uses software rendering and cannot establish native window-chrome behavior.

## Review and recovery (0.4)

Appearance supports Dark, Light, and Follow Windows. Existing selections are
preserved; new installations follow Windows. Ctrl+K opens commands, Ctrl+N starts
a session, and Ctrl+backtick focuses the container terminal. Panel widths and
visibility persist; focus layout gives the conversation more space.

Review shows checkpoints around a task and any steering messages received before
its tools finish. Select files, inspect the diff, preview restoration, and confirm.
Later edits block restoration. A recovery checkpoint is saved before project
writes. Stop active work and close the container terminal before restoring.

Checkpoint contents live in app data, outside the workspace. Capture includes Git
tracked and nonignored untracked files; ordinary folders exclude common build and
dependency directories. Symlinks and junctions are skipped. Limits are 8 MB per
file, 10,000 files and 128 MB per capture, with the newest 30 checkpoints retained
within 512 MB of stored content. Skipped files are shown explicitly. Interrupted
captures and overlapping sessions or terminal activity are marked incomplete and
cannot be restored. External edits made during a task can appear in its diff;
review the selected files before restoring.

The local file comparison detects changes since capture; it does not lock files
against unrelated external editors. Existing session history remains unchanged.

## Task continuity (0.5)

Workflow contains a persistent queue per project. Resume starts pending tasks;
successful completion advances the queue. Failure, cancellation, or RequestInput
pauses it. Restart always pauses execution and marks unfinished tasks interrupted.
Independent projects keep their own containers and can run concurrently. Tools
within an active session retain Unreal Agent's parallel execution.

Context lets you pin project files, attach session files, edit a reviewed summary,
and exclude paths from automatic context and ProjectSearch. Exclusions are context
preferences, not filesystem access restrictions. Selected text has explicit size
limits; unavailable files require review before sending. Token estimates for this
selection are separate from measured provider usage.

Provider handoff requires an idle project and a reviewed summary. It creates a
fresh session linked to its source, preserving original history and usage. Native
provider tool histories are not copied between providers. Conversation search is
local and incremental, covers messages/tool output/recorded changed filenames,
and links to event context. Other projects become searchable after being opened.

Windows notifications are opt-in under Appearance, for completion, failure, and
required input. Clicking one opens its project and session. Queue, context, links,
and indexes live in app data. `node scripts/qa-workflow.mjs --packaged` runs the
fake-provider Docker/Electron workflow verification without live provider keys.

## Diagnostics and evaluation (0.6)

Diagnostics checks local model discovery and connectivity. Ollama capabilities and
model context metadata are shown only when reported; metadata is not presented as
the active session's context allocation. The optional response test sends only a
small fixed prompt and reports observed latency and returned token counts.

Decision traces preserve purpose, focused evidence, source references, questions,
probability distributions, model version, latency, and returned usage. Explicit
user override notes are stored locally. Legacy events label missing fields.
Post-change checks run once the coordinator becomes idle, including providers
that do not supply a final-answer phase. Explicit DecisionBatch calls now also
contribute to measured decision usage.

Evaluations require selected tasks, completion criteria, a run limit (at most 20),
and a clean committed repository. Each task has a main-model-only and a selected-
decision-engine run in separate disposable worktrees. Credentials stay in memory;
existing project consent applies. Each container builds an independent Git index
in its private state volume, without exposing the source repository's Git metadata.
Instructions, provider/model, revision, and inputs are fixed for the comparison.
The selected Laya worker can be installed on demand in an isolated runtime.

Reports retain criteria, command test results, elapsed wall time including setup,
measured tokens, decision traces, explanations, and diffs. Results are observations,
not automatic claims of quality or savings. Uncaptured/binary/oversized generated
files keep their worktree for inspection. Successful capture removes the disposable
worktree and, after usage is recorded, its evaluation-only Docker state volume.
Failed cleanup exposes retained paths and a cleanup control. Cancellation stops
the active runtime; restart marks unfinished evaluations interrupted and never
automatically resumes them. Ordinary session totals exclude evaluation sessions;
provider account reports still include their real usage.

`node scripts/qa-diagnostics.mjs --packaged` checks local fixture health and UI.
Add `--live-decisions` to explicitly run a two-arm synthetic worktree comparison
using the configured TypeSafe key; its main model remains a local test fixture.

## Coding controls and isolated workspaces (0.7)

New sessions default to Ask: commands and edits wait for one-time approval tied
to the exact session, workspace and operation. Plan exposes dedicated read/search
tools; Agent runs granted project tools. Pending approvals expire after ten
minutes and cannot be reused after restart. Selecting saved history does not
resume execution; use Resume session or send a message. Historical tool results
remain readable when changing modes. Approval waiting is excluded from execution
overlap measurements.

ListFiles and ReadFile inspect project files without a shell. ReadFile returns a
revision and a bounded UTF-8 excerpt (files up to 1 MiB, output up to 64 KiB).
ApplyPatch checks revisions, supports file creation/deletion, and retains recovery
copies outside the project. Independent file operations remain concurrent;
conflicting writes to the same path are serialized.

New tasks in committed Git roots offer a reviewed isolated snapshot of tracked
and nonignored local files. Capture omissions are shown before starting. Unsaved
editor buffers are not part of that disk snapshot. Other folders retain ordinary
project sessions. Review → Isolated tasks previews changes against the source
project and blocks conflicts before integration. Recovery copies are available
through Source project and recovery. A queued isolated task with changes pauses
for integration or an explicit choice to retain its changes. Worktrees remain
available for inspection; background queue creation does not change the workspace
being edited.

Files now includes locally bundled Monaco tabs, search/replace, HEAD comparisons,
conflict-aware saves, an Open in VS Code action and selection-to-chat attachment.
Ctrl+S saves; Ctrl+F searches; Ctrl+Alt+Enter attaches a selection. Unsaved buffers
survive navigation and project switches during the current app run; closing with
unsaved changes requires confirmation. Binary/oversized files remain outside the
text editor. Native Windows path aliases, reserved names and traversal are checked.

`node scripts/qa-coding.mjs --packaged` exercises approvals, parallel reading,
dirty snapshots, integration, mode changes, editor conflicts and both themes with
a local fixture provider. `node scripts/benchmark-bridge.mjs BASELINE CANDIDATE`
compares bridge-only latency and overlap using fixture models, without user files
or provider credentials. Windows desktop and Linux Docker compatibility checks
are defined in `.github/workflows/desktop.yml`.
