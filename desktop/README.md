# UnrealCode Desktop

Windows desktop application built on the [Unreal Agent](https://github.com/unreallabsai/unreal-agent) Go harness. Electron owns credentials, GitHub access, project trust, and preferences. A per-project Docker container runs the Go coordinator and tools; sessions and sequenced events persist in a Docker volume.

## Run

1. Start Docker Desktop with its Linux engine.
2. In `desktop/`, run `npm ci` and `npm run dev`.
3. Choose one global typed-decision engine on first launch: Jev, Laya, or **Set up later**. Settings can change or disable it at any time.
4. Open a project folder and accept the native trust prompt. Only that folder and durable session storage are mounted in the container.
5. Choose a provider in Settings. The default is an existing Codex subscription login from `CODEX_HOME/auth.json` or `~/.codex/auth.json`; Codex refresh remains external. Claude API, OpenAI API, OpenRouter, and Fireworks use API keys. Ollama and private-network OpenAI-compatible Chat Completions servers are supported with model discovery.

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

The installer is `dist/UnrealCode Setup 0.3.0.exe`. It bundles backend source and builds a Docker image tagged with the app version and source fingerprint, so a rebuilt installer does not reuse an older backend image. No host Go installation is required. For a live Codex tool call, use `node scripts/qa.mjs --workspace --temp-workspace --live --tool`. A synthetic Jev integration check is `node scripts/qa.mjs --workspace --temp-workspace --decision` when `TYPESAFE_API_KEY` is available.

The installer includes third-party license texts in `resources/licenses`, plus Electron and Chromium notices at the application root. `npm run build:win` regenerates the npm notices and stops if a new dependency's license needs review.

On Windows systems with HTTPS inspection, use `$env:NODE_OPTIONS='--use-system-ca'` and a trusted `NODE_EXTRA_CA_CERTS` file for npm and Electron Builder. The backend build receives public Windows system CA certificates as a BuildKit secret. Keep TLS verification enabled.

## Architecture and boundaries

- The Go bridge uses one coordinator per active session, stable message IDs, and a serialized session store. Restart replays persisted events; stop, resume, and fork use Unreal's session model.
- Automatic preflight batches bounded route and risk questions for code-change requests when a selected engine is ready. After a Git change, a second asynchronous batch checks narrow requirement alignment and contradiction signals against the focused diff. The `DecisionBatch` tool handles search relevance and candidate selection over shortlists; `EntityExtract` is separate. The main model still plans, codes, explains, and resolves uncertain results; decision output cannot authorize a tool or Git action.
- Files, skill edits, and GitHub paths are validated against the trusted project root. Skills live in `.harness/skills`.
- The Usage screen separates UnrealCode session tokens from optional organization-wide OpenAI and Anthropic usage reports. Each organization report requires its own admin key in Settings; normal model API keys do not grant this access. Reports are refreshed no more than once every five minutes and may lag recent calls.
- With the host Codex CLI and existing ChatGPT login, Usage reads actual subscription percentages and reset times through Codex app-server. It refreshes no more than once per minute. Without the CLI or login, the account card shows an unavailable state; session tokens remain visible.
- Provider response headers show short-window rate-limit headroom separately from account totals. The Usage page reports measured input, output, cached, cache-write, reasoning, and decision tokens without estimated dollar costs. Context percentage appears only when a verified model limit is available.
- The chat activity rail shows overlapping model and tool timings and can cancel one active operation without stopping the session. Telemetry is queued off the coordinator's critical path. The interface honors reduced motion and keeps terminal text stationary.
- Hooks, MCP servers, plugins, subagents, and a Claude subscription session engine remain outside this release.
