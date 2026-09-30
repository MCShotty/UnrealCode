# Settings and shortcuts

## Settings tabs

| Tab | Main controls |
| --- | --- |
| Provider | Coding provider, model, endpoint, and credentials. |
| Memory | Separate memory model, verification, consent, and app-wide enablement. |
| Decisions | Jev, Laya, Off, project cloud consent, and optional entity extraction. |
| Agent | Agent instructions and tool restrictions. |
| Appearance | Theme, layout, notifications, and warning popups. |
| Usage | Optional account-reporting configuration. |
| Recovery | Backups, restore, cleanup, support, and application release checks. |

**Cinder Dark** uses graphite and warm coral. **Ice Dark** keeps the original blue and steel palette. **Flashbang** is light. **Follow Windows** follows the system appearance. The names are intentional, including the one your retinas might object to.

Motion follows Windows reduced-motion preferences. Incoming messages and logs keep their reading position; narrow layouts use sheets or overlays where needed. Top-bar controls can hide the session pane, toggle the activity rail, or enter focus layout.

**Show warning popups** and **Silence warnings** mute allowlisted advisory popups. Failed tasks, integrity problems, approvals, and required questions remain visible. Inline state and support diagnostics are retained.

## Keyboard controls

| Shortcut | Action |
| --- | --- |
| Ctrl+K | Open the command palette. |
| Ctrl+N | New conversation in an opened project. |
| Ctrl + backtick | Open the container terminal. |
| Enter / Shift+Enter | Send a valid draft / add a line. |
| Ctrl+Shift+. | Stop the current task. |
| Ctrl+Alt+Shift+. | Emergency stop for managed Computer access. |
| Escape | Dismiss supported dialogs and pickers. |

Use `/help` to search available commands. Unknown slash commands show an error; `//text` sends literal slash text.

The menu bar's **UnrealCode** menu offers the same local commands as the palette. File, Edit, View, and Window provide the usual window, editing, and view controls.

## Slash commands

| Command | Purpose |
| --- | --- |
| `/plan optional prompt` | Plan with reading tools, milestones and acceptance criteria. |
| `/ask` | Require approval for actions. |
| `/agent` | Execute within granted project permissions. |
| `/fast on / off` | Use a verified provider speed tier. |
| `/reasoning effort` | Choose supported reasoning effort. |
| `/model` | Inspect the current model or prepare a provider handoff. |
| `/agents` | Configure Agent team, role profiles, and delegation. |
| `/tasks` | Inspect task queue and background jobs. |
| `/permissions` | Inspect execution mode and pending approvals. |
| `/status` | Inspect session, runtime, model and limits. |
| `/usage` | Inspect measured token and account usage. |
| `/context` | Inspect instructions, files, memory and summaries. |
| `/compact` | Summarize context at an idle boundary. |
| `/review` | Review changes and verification evidence. |
| `/diff` | Inspect changed files and diffs. |
| `/checkpoint` | Inspect recoverable turn checkpoints. |
| `/rewind` | Preview selective conflict-aware restoration. |
| `/fork` | Fork this conversation. |
| `/resume` | Explicitly resume this retained session. |
| `/rename title` | Set this chat title. |
| `/new` | Start a new conversation. |
| `/skills optional name` | Browse built-in and project skills, or invoke a skill. |
| `/mcp` | Manage connected tools and resources. |
| `/computer` | Manage selected Windows application access and takeover. |
| `/fieldnotes` | Open user-authored guidance and its project/session pointers. |
| `/memory` | Inspect Hindsight memory and processing. |
| `/browser` | Open the shared project browser. |
| `/hooks` | Review project lifecycle hooks. |
| `/init` | Draft project instructions for review. |
| `/goal optional objective` | Manage a bounded persistent objective. |
| `/help` | Search commands and availability. |
