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

> **Windows distribution:** Releases use an unsigned installer, a SHA-256 manifest, and a Git tag. The corrected private 1.0.1 replacement was built locally because GitHub Actions would not start runners; unlike the original release, it has no GitHub Artifact Attestation. [Verify the release](desktop/VERIFY_RELEASE.md) before installing. Windows will still report an unknown publisher. Repository access is required. Release checks can use the existing host `gh` login for that private listing. Downloads and installation remain manual. See the [changelog](CHANGELOG.md) and [Releases page](https://github.com/MCShotty/UnrealCode/releases).

## New in 1.0.1

- **App-wide memory:** enable it once, select its separate model, and recall relevant knowledge across chats and trusted projects with source attribution. Existing project memories migrate only after expanded-scope consent.
- **Useful activity timelines:** recorded events remain available offline; optional memory-model summaries cite evidence and describe inferred stages without changing approved plans.
- **Provider recovery:** searchable Codex model discovery and explicit refusal, account-access, quota, rate-limit and context-limit explanations. A declined response is recorded as a failure.
- **A clearer workspace:** contained Files & skills picker, cobalt/red/steel light and dark themes, accessible contrast, and Material 3 Expressive feedback that respects reduced motion.
- **Release notifications:** optional startup/daily checks, a dismissible notice, and a link to the release changelog. See [upgrade instructions](#installing-and-upgrading).
- **Replacement build repairs:** Jev type normalization, clearer Agent team prerequisites, verified memory-provider switching with rollback, durable partial responses, streamed text previews, and a concise stage timeline.
- **Documents and browser:** built-in PDF, OCR, Markdown, and browser-use skills; a local PDF reader with page text and English/Arabic OCR; live project browser tabs shared with the main agent only under explicit origin grants.

The [1.0.1 changelog](CHANGELOG.md#101--2026-09-29) also covers the memory, shutdown, timeline and Docker reliability fixes.

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
| **Agent team (subagents)** | Off / Manual / Automatic project defaults with per-task controls. Explorer, implementer, reviewer and browser tester profiles can select their own model, endpoint, effort and limits. Isolated worktrees, queued dispatch, follow-up, cancellation, reviewed integration and separate/combined usage. No nested delegation. Git, an opened repository root, and an initial commit are required; GitHub login and a clean working tree are not. |
| **Plans and commands** | Shared slash/menu/palette commands, editable versioned plans, explicit implementation, bounded persistent goals, safe-boundary mode changes, and capability-aware speed/effort controls. `/fast` requests a provider tier and reports the actual tier returned. |
| **App-wide memory** | Optional local Hindsight with a separately verified model, bounded retention, cross-project recall with source attribution, corrections, forgetting, exports and recovery. Unintegrated specialist knowledge remains task-scoped. Coding stays available during memory outages. |
| **Activity timeline** | Durable factual events and approved plan stages, with optional evidence-linked summaries from the memory model. Observer usage is recorded separately within memory usage; analysis runs at most once per 20 seconds per conversation with two global slots. |
| **Browser and jobs** | Live in-app project tabs with their own sign-ins, back/forward, find, zoom and downloads. The main agent can use those tabs only after project and exact-origin grants and handback; its browser tools and optional Jev BrowserDo remain permission-bound. Specialist workers retain isolated browser state. Managed background commands and reviewed container hooks remain available. |
| **Documents and skills** | Built-in read-only PDF reading/parsing, English and Arabic OCR, Markdown, and browser-use guidance across projects. A PDF reader renders pages and selectable text; bounded agent tools inspect metadata, page text, search, and selected-page OCR. Trusted `.harness/skills` files may extend or override built-ins without gaining permissions. |
| **Verification** | Saved review/test/fix workflows, named verification commands, bounded opt-in repair loops, local model health checks, and explicitly started decision-model comparisons. |
| **Usage and performance** | Provider-reported session tokens, cache/reasoning/decision usage where available, a parallel operation inspector, Codex subscription percentages, and optional organization reports. No estimated dollar costs. |
| **Desktop experience** | Dark, Light, and Follow Windows themes; resizable/collapsible panels, focus layout, command palette, container terminal, restrained spring animations, and reduced-motion support. |
| **Recovery and releases** | Settings/session backup and restore, integrity checks, pre-migration backups, guarded recovery-volume reattachment, cleanup previews, and redacted support exports. Unsigned builds can discover releases but cannot automatically install them. |

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

The shared model selector reads the installed Codex CLI's paginated catalog for chat, memory and specialist profiles. Listed models are distinguished from explicit access rejections; hidden or omitted models are not assumed unavailable. Manual model IDs are labelled unverified. Changing a provider for an existing conversation uses reviewed handoff.

## Installing and upgrading

Download the installer and `SHA256SUMS` from the same [GitHub release](https://github.com/MCShotty/UnrealCode/releases), follow the [verification guide](desktop/VERIFY_RELEASE.md), settle active tasks, and close UnrealCode before installing. Settings and session data are preserved; normal migration/recovery checks still apply.

**Upgrading from 1.0.0 requires a manual installation.** Its disabled updater cannot acquire the notification feature. The corrected 1.0.1 replacement has the **same version number** as the previous private installer, so an existing 1.0.1 installation also requires a manual reinstall: a version comparison cannot announce it as newer. **Settings → Recovery → Application updates** offers Stable/Preview channels, manual checks, and an automatic-check switch. Automatic checks are enabled by default and run when due after startup and at most once daily. For the private repository, the checker may use the existing host GitHub CLI login; it sends no project content. No installer is downloaded or run automatically.

Memory remains optional. Before existing project memories become app-wide, review the broader recall scope and the configured model destination. Disabled memory stays disabled; enabling it does not ingest every historical conversation. Repository-specific knowledge keeps its original source labels and cannot grant access to another project's files.

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

On first launch, choose or skip the decision engine, select a provider, open a project, and review its trust prompt. The app prepares its Docker backend from bundled source. Missing Docker, expired credentials, and unreachable endpoints have setup/reconnect actions.

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

Project files remain in the selected folder or an app-owned task worktree. Preferences, queue/index/checkpoint metadata, and recovery copies live in app data; raw sessions/events live in Docker volumes. Five built-in read-only skills ship with the app; `.harness/skills` supplies trusted project extensions or overrides. Restart restores history and visible state; interrupted execution requires an explicit resume.

Electron uses a bundled native Go helper for host project and recovery file access.
It operates through opened directory handles to resist concurrent junction swaps.
Hard-linked files and ReFS locations are currently unsupported; use NTFS.

MCP supports remote Streamable HTTP, Windows-hosted stdio, and container stdio through the official SDK. Host servers have the Windows account's access and require separate host trust. Project grants and per-call approvals apply; server-initiated model sampling is disabled. Context exclusions control retrieval, not filesystem permissions.

### Optional Windows computer use

The [Windows computer-use MCP add-on](integrations/windows-computer-use/README.md)
can be installed separately and connected to an existing UnrealCode 1.0.2 app.
It adds window inspection and interaction through a pinned, allowlisted
Windows-hosted server, with project grants and per-call approvals. Installation
and connection are manual; it does not change the 1.0.2 installer or provide a
built-in computer-use panel.

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
| **PDF.js / Tesseract.js / tessdata_fast** | Local PDF rendering and text extraction, with selected-page OCR. | Apache-2.0. English/Arabic language data downloads only when requested and is SHA-256 checked against the pinned source. |
| **@napi-rs/canvas / Skia** | Off-main-thread PDF page rendering for OCR. | MIT / BSD-style; bundled source and native-package notices. |
| **jev-browser 0.1.1** | Adapted page-diff and one-outcome decision flow for the shared Electron browser; no separate browser process or environment-key client. | MIT, Ying-Kai Liao; pinned source and modification notice. |
| **mime-types / mime-db** | Preserve upload content types when sending confined file buffers to the project browser. | MIT. |
| **Hindsight / PostgreSQL + pgvector** | Optional local long-term memory and its database. | MIT / PostgreSQL-style licenses; separately downloaded pinned images. [Runtime inventory](desktop/OPTIONAL_RUNTIME_INVENTORY.md). |
| **Go modules and generated OpenAI client** | Runtime helpers, image handling, and typed Responses API bindings. | [Go notices](desktop/third-party-licenses/go/) and [pinned OpenAPI provenance](third_party/openai-openapi/README.md). |

The [third-party notice inventory](desktop/third-party-licenses/README.md) and [generated npm notices](desktop/third-party-licenses/NPM_NOTICES.txt) contain the complete production dependency attributions, including specifically reviewed license exceptions. The Windows build regenerates notices and rejects unreviewed licenses. Docker base-image package notices remain inside the image.

[Claude Code GUI](https://github.com/markes76/claude-code-gui) was a visual and workflow reference; UnrealCode's desktop implementation is built around Unreal Agent. Its branding and Claude-specific pages are not included. The flat UC mark was redrawn from the project owner's supplied reference; editable SVGs and light/dark exports are in [desktop/assets/brand](desktop/assets/brand/).

**Not bundled in the Windows installer:** Docker Desktop, Windows Git, GitHub CLI, Codex CLI, Ollama, optional Laya/GLiNER packages, the legacy Playwright browser runtime, Hindsight/PostgreSQL images, OCR language data, or model weights. The new shared browser uses Electron's included Chromium; the older isolated browser remains available for recovery. The locally built backend image installs its own Git and Python utilities. No provider login, API credential, signing certificate, or real project backup belongs in a release.

## Build, test, and contribute

From `desktop/`:

```powershell
npm run typecheck
npm test
npm run build:win
```

The build creates a local NSIS installer under `desktop/dist/`; it does not publish a GitHub release. The [Windows release workflow](.github/workflows/desktop-release.yml) builds from a tagged commit and publishes only after the tests, audits, checksum, and attestation checks pass. Its [packaging](desktop/scripts/build-release.mjs) and [checksum](desktop/scripts/sha256-release.mjs) scripts are in this repository. See [BUILDING.md](desktop/BUILDING.md) for local steps and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance. Coding assistants should read [AGENTS.md](AGENTS.md). Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Release provenance, signing, and privacy

The Windows installer is unsigned. Its SHA-256 manifest checks the downloaded
bytes against the release manifest. The corrected 1.0.1 replacement has no
GitHub build attestation; the original 1.0.1 and 1.0.0 releases did. Use the
[verification guide](desktop/VERIFY_RELEASE.md) for each
download. The [code signing policy](CODE_SIGNING_POLICY.md) records the deferred
SignPath option; no installer is represented as signed before its actual
signature is checked. [Privacy and data flows](PRIVACY.md) explains local storage
and when configured providers, connections, and other services receive information.

### Current limits

Windows + Docker is the supported target. Native execution, macOS/Linux desktop support, full language servers/debugging, an extension marketplace, and Claude subscription integration are outside this release. Recovery import currently requires the original Windows profile/app-data and project paths. Trusted publisher identity and automatic installation remain unavailable for unsigned builds. Full assistive-technology acceptance has not been established.

### Warning popups

Settings → Appearance → **Show warning popups** controls optional and background warnings. You can also select **Silence warnings** on an advisory notice. The preference survives restart. Failed tasks, data problems, approvals and required answers stay visible; muting does not remove inline feature status or support diagnostics.
