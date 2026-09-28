<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="desktop/assets/brand/unrealcode-mark-dark.svg">
    <img src="desktop/assets/brand/unrealcode-mark-light.svg" alt="UnrealCode" width="112" height="112">
  </picture>
</p>

# UnrealCode

**A Windows desktop workspace for AI-assisted coding, built on Unreal Agent.**

Bring your own provider, open a project, and work with an agent that can inspect code, edit files, run tools in Docker, and respond to steering while it works. Review the conversation, parallel tool activity, changes, and measured usage in one application. Use isolated Git worktrees when a task needs its own workspace, then review and integrate its changes into your project.

UnrealCode is a general-purpose coding application. It does not require Unreal Engine. Its execution engine is the [Unreal Agent Go harness](https://github.com/unreallabsai/unreal-agent) from Unreal Labs; the desktop application adds the interface, project controls, provider setup, integrations, and recovery workflows.

> **Development status:** this checkout contains `1.0.0-preview.1` source for hosted CI and an unsigned local installer. Stable 1.0 still needs a trusted signing identity and a verified signed package before it can be tagged or published. See [current implementation and verification](desktop/PARITY_IMPLEMENTATION.md), [release status](desktop/ROADMAP_STATUS.md) and [preview history](desktop/RELEASE_1.0_PREVIEW.md) for verified checks and limits. Published installers, when available, are on the [Releases page](https://github.com/MCShotty/UnrealCode/releases).

## What you can do

| Area | Features |
| --- | --- |
| **Coding sessions** | Chat, persistent history, resume and fork, live steering, independent parallel tools, and cancellation of one operation or the whole session. |
| **Execution controls** | Plan, Ask, and Agent modes; Ask is the default. Approval previews identify the operation, workspace, and arguments. Native file tools detect stale revisions before patching. |
| **Project workspaces** | Reviewed snapshots of tracked and non-ignored files, isolated Git tasks, conflict-aware integration, turn checkpoints, selective rollback, and recoverable worktree archival. |
| **Editing and review** | Monaco tabs, syntax highlighting, search/replace, unsaved buffers, selection-to-chat, unified/side-by-side comparisons, changed files, verification results, and review comments sent as steering. |
| **GitHub** | Existing `git`/`gh` login, cloning, branches/worktrees, staging, commits, pushes, PR creation/review, checks, and issue or review-comment intake. Remote changes have explicit previews. |
| **Tools and context** | MCP connections, a searchable tool catalog, local repository retrieval with file/line references, attachments, explicit skills, pinned context, exclusions, and reversible summaries. |
| **Continuity** | A persistent queue per project, manual provider handoff into a linked session, local conversation search, and optional Windows notifications. Projects can run concurrently; each project's queued tasks run sequentially. |
| **Specialist teams** | Off / Manual / Automatic project defaults with per-task controls. Explorer, implementer, reviewer and browser tester profiles can select their own model, endpoint, effort and limits. Isolated worktrees, queued dispatch, follow-up, cancellation, reviewed integration and separate/combined usage. No nested delegation. |
| **Plans and commands** | Shared slash/menu/palette commands, editable versioned plans, explicit implementation, bounded persistent goals, safe-boundary mode changes, and capability-aware speed/effort controls. `/fast` requests a provider tier and reports the actual tier returned. |
| **Project memory** | Optional local Hindsight with a separately verified memory model, bounded automatic retention, source provenance, scoped recall, corrections, forgetting, exports and recovery. Coding remains available if memory is unavailable. |
| **Browser and jobs** | Dedicated isolated Chromium, approved origins and loopback previews, model-visible screenshots, managed background commands, and reviewed container hooks. Browser profiles are separate from personal browsers. |
| **Verification** | Saved review/test/fix workflows, named verification commands, bounded opt-in repair loops, local model health checks, and explicitly started decision-model comparisons. |
| **Usage and performance** | Provider-reported session tokens, cache/reasoning/decision usage where available, a parallel operation inspector, Codex subscription percentages, and optional organization reports. No estimated dollar costs. |
| **Desktop experience** | Dark, Light, and Follow Windows themes; resizable/collapsible panels, focus layout, command palette, container terminal, restrained spring animations, and reduced-motion support. |
| **Recovery — local preview** | Settings/session backup and restore, integrity checks, pre-migration backups, guarded export and reattachment of verified interrupted-restore volumes, storage cleanup previews, redacted support exports, and signed-update infrastructure. Unsigned builds keep updates unavailable. |

## Providers and sign-in

All coding providers use Unreal Agent's coordinator, session history, and tools. UnrealCode does not launch a separate Claude Code session engine.

| Provider | Authentication / runtime |
| --- | --- |
| **ChatGPT / Codex** | An existing external Codex login. Login and token refresh happen through Codex; the installed Codex CLI also supplies subscription limit percentages. |
| **OpenAI** | API key entered in Settings. |
| **Anthropic Claude** | Anthropic API key entered in Settings. **Claude subscription login is not supported.** |
| **OpenRouter / Fireworks** | The corresponding provider API key. |
| **Ollama** | A separately installed local Ollama server, with model discovery. |
| **OpenAI-compatible local servers** | A local or private-network Chat Completions endpoint, with optional API key. Capabilities depend on the runtime. |

API keys stay in Electron's main process and are encrypted locally with Electron `safeStorage` when available; otherwise they remain in memory for that run. Provider credentials reach the backend through its private input stream, never Docker arguments or environment variables. The renderer receives credential status, not plaintext keys.

Session usage and account usage are separate. OpenAI/Anthropic organization reports require optional, separate admin credentials and can include usage from other applications. Codex percentages come from reported account limits, not a conversion from token counts. Unknown context limits and unavailable account data are labelled accordingly.

## Optional decision models

Choose **Jev**, **Laya**, or **Off** globally in Settings. This choice applies to all projects and chats. The main coding model still plans, writes code, explains results, and handles uncertainty.

- **Jev / TypeSafe:** bounded Choice, Noul, and Score questions over focused evidence. Requires `TYPESAFE_API_KEY` in the host environment and separate consent for each project before project text is sent to TypeSafe.
- **Laya:** an optional local worker installed with its model cache on demand.
- **GLiNER:** optional local entity extraction. It is a separate tool, not a decision engine.

Decision traces retain purpose, evidence references, engine/model, probabilities, latency, and reported usage. An unavailable engine is shown explicitly; the app does not silently switch engines. Decision results never authorize tools, Git operations, or broader permissions. Opt-in evaluations compare paired tasks in disposable worktrees and report observations, not promised savings.

## Getting started

### Requirements

- Windows with Docker Desktop running its **Linux container engine**.
- Git for repository features; GitHub CLI (`gh`) signed in for GitHub integration.
- One configured provider or local model server. No API key is needed to build the app or run fixture tests.
- For source development: Node.js 24+ and npm. Docker supplies the pinned Go toolchain; host Go is optional.

### Run from source

```powershell
git clone https://github.com/MCShotty/UnrealCode.git
cd UnrealCode/desktop
npm ci
npm run dev
```

Repository access is required while it is private. On first launch, choose or skip the decision engine, select a provider, open a project, and review its trust prompt. The app prepares its Docker backend from bundled source. Missing Docker, expired credentials, and unreachable endpoints have setup/reconnect actions.

Start with **Ask** mode. Use **Review** to inspect a task's changes before integrating an isolated workspace or restoring selected checkpoint files.

## How it works

```text
React desktop interface
        │ narrow typed preload API
Electron main: credentials · trust · GitHub · MCP · workspaces · recovery
        │ versioned JSONL requests, responses, and sequenced events
Docker backend: Unreal Agent Go bridge
        ├─ one coordinator per active session
        ├─ asynchronous, independently cancellable operations
        ├─ selected provider and optional decision worker
        └─ trusted project mount + durable session volume
```

The harness retains asynchronous tool execution and live steering. Waiting for one tool or approval does not serialize unrelated tool operations. The app records overlap and measured usage; it does not promise a fixed speedup or token reduction for every task.

Project files remain in the selected folder or an app-owned task worktree. Preferences, queue/index/checkpoint metadata, and recovery copies live in app data; raw sessions/events live in Docker volumes. Skills use `.harness/skills`. Restart restores history and visible state; interrupted execution requires an explicit resume.

Electron uses a bundled native Go helper for host project and recovery file access.
It operates through opened directory handles to resist concurrent junction swaps.
Hard-linked files and ReFS locations are currently unsupported; use NTFS.

MCP supports remote Streamable HTTP, Windows-hosted stdio, and container stdio through the official SDK. Host servers have the Windows account's access and require separate host trust. Project grants and per-call approvals apply; server-initiated model sampling is disabled. Context exclusions control retrieval, not filesystem permissions.

See [desktop documentation](desktop/README.md), [harness architecture](docs/UNREAL_AGENT_ARCHITECTURE.md), and [security boundaries](SECURITY.md) for details.

## Third-party code and attribution

UnrealCode retains the upstream **MIT license and Unreal Labs attribution**. The Go module path remains `github.com/unreallabsai/unreal-agent` to preserve internal imports and upstream history.

| Component | Used for | License / provenance |
| --- | --- | --- |
| **Unreal Agent** | Coordinator, inbox, operations, session store, tools, and provider foundations; extended by UnrealCode. | [MIT](LICENSE), Unreal Labs. Starting revision: `1b9f778453f411c029b39b85102aaefb95e7e48d`. |
| **Electron / Chromium / Node.js** | Desktop shell and embedded runtime. | Electron/Node MIT plus Chromium component licenses; shipped notices accompany the installer. |
| **React / React DOM** | Desktop interface. | MIT. |
| **Monaco Editor** | Local editor and diff components. | MIT. |
| **xterm.js / node-pty** | Terminal rendering and host PTY transport for container commands. | MIT, with winpty and Microsoft terminal component notices. |
| **Motion / Lucide / react-markdown** | Animation, interface icons, and Markdown messages. | Motion/react-markdown MIT; Lucide ISC. |
| **Official MCP TypeScript SDK / Ajv** | MCP transports and argument validation. | MIT. |
| **electron-updater** | Update metadata, downloads, and installer verification integration. | MIT, with transitive dependency notices. |
| **Playwright Core** | Dedicated project-browser automation. | Apache-2.0; bundled package notices. Chromium runtime downloads on demand. |
| **mime-types / mime-db** | Preserve upload content types when sending confined file buffers to the project browser. | MIT. |
| **Hindsight / PostgreSQL + pgvector** | Optional local long-term memory and its database. | MIT / PostgreSQL-style licenses; separately downloaded pinned images. [Runtime inventory](desktop/OPTIONAL_RUNTIME_INVENTORY.md). |
| **Go modules and generated OpenAI client** | Runtime helpers, image handling, and typed Responses API bindings. | [Go notices](desktop/third-party-licenses/go/) and [pinned OpenAPI provenance](third_party/openai-openapi/README.md). |

The [third-party notice inventory](desktop/third-party-licenses/README.md) and [generated npm notices](desktop/third-party-licenses/NPM_NOTICES.txt) contain the complete production dependency attributions, including specifically reviewed license exceptions. The Windows build regenerates notices and rejects unreviewed licenses. Docker base-image package notices remain inside the image.

[Claude Code GUI](https://github.com/markes76/claude-code-gui) was a visual and workflow reference; UnrealCode's desktop implementation is built around Unreal Agent. Its branding and Claude-specific pages are not included. The flat UC mark was redrawn from the project owner's supplied reference; editable SVGs and light/dark exports are in [desktop/assets/brand](desktop/assets/brand/).

**Not bundled in the Windows installer:** Docker Desktop, Windows Git, GitHub CLI, Codex CLI, Ollama, optional Laya/GLiNER packages, the dedicated Playwright browser, Hindsight/PostgreSQL images, or model weights. The locally built backend image installs its own Git and Python utilities. Users install host runtimes separately; optional workers/models are downloaded on demand under their own terms. No provider login, API credential, signing certificate, or real project backup belongs in a release.

## Build, test, and contribute

From `desktop/`:

```powershell
npm run typecheck
npm test
npm run build:win
```

The build creates a local NSIS installer under `desktop/dist/`; it does not publish a GitHub release. See [BUILDING.md](desktop/BUILDING.md) for Docker, packaged-app, signing, and audit checks, and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance. Coding assistants should read [AGENTS.md](AGENTS.md). Report vulnerabilities using [SECURITY.md](SECURITY.md).

### Current limits

Windows + Docker is the supported target. Native execution, macOS/Linux desktop support, full language servers/debugging, an extension marketplace, and Claude subscription integration are outside this release. Recovery import currently requires the original Windows profile/app-data and project paths. Fresh-machine installation, real publisher signing/signed updates, and full assistive-technology acceptance remain prerequisites for stable 1.0.
