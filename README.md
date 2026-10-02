<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="desktop/assets/brand/unrealcode-mark-dark.svg">
    <img src="desktop/assets/brand/unrealcode-mark-light.svg" alt="UnrealCode" width="112" height="112">
  </picture>
</p>

# UnrealCode

**A Windows workspace for coding with an AI agent, built on Unreal Agent.**

Bring your own model, open a project, and use chat, editing, parallel tools, review, and recovery in one app. You can steer the agent while it works, give independent tasks to subagents, and inspect what changed before integrating it. Unreal Engine is not required.

**[Download latest](https://github.com/MCShotty/UnrealCode/releases/latest)** · **[Full wiki](https://github.com/MCShotty/UnrealCode/wiki)** · **[Changelog](CHANGELOG.md)**

The installer is **unsigned**. Verify its [checksum and GitHub build attestation](desktop/VERIFY_RELEASE.md), then install manually. These checks do not remove Windows publisher warnings. Release notifications open GitHub; they never download or execute an installer.

## Start here

1. Install Docker Desktop and start its **Linux container engine**.
2. Configure a provider in **Settings > Provider**.
3. Open an NTFS project folder and review the trust prompt.
4. Let UnrealCode prepare its bundled Docker backend.
5. Start in **Ask** mode. Try asking it to inspect the project and run relevant tests.

Git is needed for repository features, isolated worktrees, and Agent team. GitHub CLI is needed for GitHub integration. Plain folders still work for chat and files. Optional memory and decision engines can be left off.

Read [Getting started](https://github.com/MCShotty/UnrealCode/wiki/Getting-started) for installation and [Troubleshooting](https://github.com/MCShotty/UnrealCode/wiki/Troubleshooting) for Docker, models, and recovery.

## What is in the app?

| Area | Features | Guide |
| --- | --- | --- |
| Chat | Persistent sessions, streaming where supported, questions, forks, live steering, collapsible work, and cancellation. | [Chat and sessions](https://github.com/MCShotty/UnrealCode/wiki/Chat-and-sessions) |
| Coding | Monaco, container terminal, diffs, checkpoints, conflict-aware integration, Git and GitHub. | [Files](https://github.com/MCShotty/UnrealCode/wiki/Files-and-terminal), [Review](https://github.com/MCShotty/UnrealCode/wiki/Review-and-GitHub) |
| Task control | Plan, Ask, Agent, versioned plans, bounded goals, queues, background jobs, hooks, and saved verification workflows. | [Planning](https://github.com/MCShotty/UnrealCode/wiki/Planning-and-goals), [Workflows](https://github.com/MCShotty/UnrealCode/wiki/Workflows-jobs-and-hooks) |
| Agent team | Manual or opt-in automatic subagents, separate role profiles, isolated worktrees, and reviewed integration. | [Agent team](https://github.com/MCShotty/UnrealCode/wiki/Agent-team) |
| Knowledge | Context inspection, instructions, app-wide Fieldnotes, optional Hindsight memory, skills, and MCP connections under Abilities. | [Context](https://github.com/MCShotty/UnrealCode/wiki/Context-and-instructions), [Fieldnotes](https://github.com/MCShotty/UnrealCode/wiki/Fieldnotes), [Memory](https://github.com/MCShotty/UnrealCode/wiki/Memory), [Abilities](https://github.com/MCShotty/UnrealCode/wiki/Skills-and-MCP) |
| Browser and documents | Live project tabs, origin-based agent grants, PDF reading/parsing, selected-page English/Arabic OCR, and Markdown guidance. | [Browser](https://github.com/MCShotty/UnrealCode/wiki/Browser), [Documents](https://github.com/MCShotty/UnrealCode/wiki/Documents-and-OCR) |
| Computer | Experimental, default-off selected-window controls, reviewed task/model-bound grants, takeover, handback, and emergency stop. | [Computer](https://github.com/MCShotty/UnrealCode/wiki/Computer) |
| Visibility | Tool Activity, stage timelines, measured usage, diagnostics, support, backups, and cleanup previews. | [Activity](https://github.com/MCShotty/UnrealCode/wiki/Tool-Activity-and-timeline), [Recovery](https://github.com/MCShotty/UnrealCode/wiki/Storage-and-recovery) |

**New in 1.1.0:** background decision advice and memory recall, durable message receipts, and cancellation and transport repairs. See [release notes](desktop/RELEASE_NOTES_1.1.0.md) and [verified release identity](desktop/RELEASE_VERIFICATION_1.1.0.md).

Connected, model-authored timelines, a four-entry work feed, and Compact spacing with Cozy remain available. [Layout acceptance](desktop/ACCEPTANCE_1.0.4.md) and the [bug-hunt record](desktop/BUG_HUNT_1.0.4.md) document their tests and remaining gates.

Appearance offers **Cinder Dark**, **Ice Dark**, **Flashbang**, and **Follow Windows**. Material 3 Expressive motion respects reduced motion. See [Settings and shortcuts](https://github.com/MCShotty/UnrealCode/wiki/Settings-and-shortcuts) for every slash command and keyboard control.

## Models and credentials

Supported providers are ChatGPT/Codex through an existing external Codex login, OpenAI, Anthropic API, OpenRouter, Fireworks, Ollama, and OpenAI-compatible servers. **Claude subscription login is not supported.**

The shared model selector distinguishes catalog listings, explicit access rejections, and unknown availability. Manual IDs are unverified. `/fast` requests a supported provider speed tier; it does not switch models or lower reasoning. Changing an existing provider uses a reviewed handoff.

Keys stay in Electron main and use Windows encryption when available. Provider credentials reach the backend in memory, not Docker arguments or environment variables. Memory chooses its own model but shares that provider's saved credentials with chat.

Jev, Laya, and Off are optional decision-engine choices. GLiNER is separate local entity extraction. Jev requires its host key and project cloud consent. Decision results never grant permissions, and unavailable engines are not silently replaced.

The [1.1.0 asynchronous execution implementation](docs/ASYNC_EXECUTION.md) moves
decision advice and memory recall behind message acceptance. Steering and Stop
continue while they run. Applicable references arrive at a safe model boundary;
they cannot answer questions, approve actions or reopen completed work.
See the [1.1.0 release notes](desktop/RELEASE_NOTES_1.1.0.md) for changes and
recovery limitations.

## Storage and privacy

Project files remain in the chosen folder or a task worktree. Backend sessions live in Docker volumes. Electron stores settings, Fieldnote originals, recovery metadata, and a rebuildable SQLite history cache with one writer and two readers.

Cached history and Fieldnotes work offline. Running tools needs the backend. Restart restores visible state without replaying commands, workers, queues, or goals automatically.

Memory is optional and app-wide after scope and model consent. It recalls relevant knowledge with source attribution; unintegrated worker findings remain task-scoped. Fieldnotes are user-authored guidance with visible revision receipts. Notes and memories cannot grant access to another project's files.

PDF/OCR processing stays local. Documents are not automatically remembered. Browser sign-ins are isolated per project and excluded from normal backups. Computer captures are transient unless explicitly attached, and native-derived content is excluded from automatic memory.

Read [PRIVACY.md](PRIVACY.md) for destinations and exclusions. Report security issues privately through [SECURITY.md](SECURITY.md).

## Build and contribute

Source development needs Windows, Node.js 24+, npm, .NET SDK **10.0.401**, and Docker's Linux engine. The host file helper uses the Go version in `go.mod`, or Docker can build it. Installed users do not need a .NET SDK.

```powershell
git clone https://github.com/MCShotty/UnrealCode.git
cd UnrealCode/desktop
npm ci
npm run dev
```

Use `npm run typecheck`, `npm test`, and `npm run build:win` for a local candidate. Builds do not publish. [BUILDING.md](desktop/BUILDING.md) covers full gates; [AGENTS.md](AGENTS.md) records current architecture and working rules. The wiki is also tracked in [docs/wiki](docs/wiki/Home.md).

Authorized releases use a reviewed commit, exact-commit preflight, annotated tag, hosted build, audits, checksum manifest, and GitHub attestation. The historical local 1.0.1 replacement has no hosted attestation. Earlier tags and assets stay intact.

## Attribution and current limits

UnrealCode uses the [Unreal Agent Go harness](https://github.com/unreallabsai/unreal-agent) from Unreal Labs and retains its [MIT license](LICENSE) and module path. [Dependency notices](desktop/third-party-licenses/README.md) cover Electron/Chromium, React, Monaco, terminal components, PDF.js, Tesseract.js, adapted Jev browser code, and the pinned Windows MCP service used by Computer.

Docker Desktop, Git/gh, Codex CLI, Ollama, optional memory images, OCR language data, isolated-browser runtime, and model weights are separate installs or downloads.

Windows with Docker is the supported coding platform. Native host execution of the coding backend, macOS/Linux desktop releases, a marketplace, and full language-server/debugger support are outside this version. Computer remains experimental: actual native input/capture, physical takeover, lock/desktop/DPI behavior, live populated-memory recovery, fresh-machine installation, and full assistive-technology acceptance remain open. Recovery import currently needs the original profile and project paths.

See [1.1.0 release notes](desktop/RELEASE_NOTES_1.1.0.md) and the [verified release record](desktop/RELEASE_VERIFICATION_1.1.0.md). Unsigned installation stays manual.
