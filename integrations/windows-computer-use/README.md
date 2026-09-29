# Optional Windows computer use for UnrealCode 1.0.2

UnrealCode 1.0.2 can use a Windows-hosted stdio MCP server without changing its
installer. This add-on downloads a pinned standalone build of
[sbroenne/mcp-windows](https://github.com/sbroenne/mcp-windows) and tells you how
to connect it. It does **not** modify UnrealCode settings, start the server,
approve tools, or grant access to a project. The app's existing Connections UI
handles those decisions.

The upstream server is MIT licensed. The add-on downloads it from its own
[v1.3.25 release](https://github.com/sbroenne/mcp-windows/releases/tag/v1.3.25)
and verifies both the archive and executable SHA-256 values. UnrealCode does
not redistribute that binary.

## Install the sidecar

Requirements: 64-bit Windows, an unlocked desktop, UnrealCode 1.0.2, and a
trusted project open in UnrealCode. Docker must be available for the project's
agent session. Download this repository or the script from a reviewed commit,
inspect it, then run from PowerShell:

```powershell
.\integrations\windows-computer-use\Install.ps1
```

The default location is
`%LOCALAPPDATA%\UnrealCode\Addons\WindowsComputerUse\v1.3.25`. Use
`-InstallRoot <directory>` to choose another location. The script prints the
executable path and JSON arguments for Connections. It is safe to rerun:
an existing executable is reused only when its hash matches.

The pinned archive hash is
`F9BC55661593AF5CBB0BE338EF6AD0D4D2F2668319748BE1BFBD46684A080A51`.
The extracted executable hash is
`7049ACB6583F69EFB287916EB2D745ABACFA7A731640A6CCEF538ADEB33B2716`.
The upstream executable is unsigned; the hashes establish file identity, not
Windows publisher trust.

## Connect it to UnrealCode

1. Open a trusted project, then **Connections → Add connection**.
2. Name it **Windows computer use** and select **Windows · stdio**.
3. Paste the exact executable path printed by the script. Set **Arguments
   (JSON array)** to:

   ```json
   ["--tools","window_management,ui_snapshot,ui_find,ui_click,ui_type,ui_select,ui_read,ui_wait,screenshot_control,keyboard_control,mouse_control"]
   ```

4. Keep authentication at **None / server environment** and save.
5. Choose **Grant project access**. Review the Windows host trust prompt: this
   server runs under your Windows account and is not confined by Docker.
6. Choose **Connect / reconnect**, open **Tools, resources and prompts**, and
   check only the tools this project needs. Start with
   `window_management`, `ui_snapshot`, `ui_find`, and `ui_read`. Add click,
   type, keyboard, mouse, or screenshot tools when the task needs them.

The connection definition is available across the app profile, but each
project needs its own grant. Every MCP tool call still requests approval,
including read-only observations and Agent mode actions. Plan mode cannot run
MCP actions. This is the existing 1.0.2 permission model.

To give the agent task guidance, copy [SKILL.md](SKILL.md) to
`<project>/.harness/skills/computer-use/SKILL.md`. Project skills are optional
and do not add permissions. The 1.0.2 Skills editor's **New skill** button uses
the fixed `new-skill` folder, so create the `computer-use` directory in the
project filesystem.

## Screenshots in 1.0.2

The current MCP broker serializes server results as text; it does not forward
an MCP image block to the model as an image. Prefer the server's UI Automation
tools, which return useful text. For a visual-only control:

1. Have `screenshot_control` capture the intended window with
   `target: "window"`, its observed `windowHandle`, `annotate: false`,
   `outputMode: "file"`, and a unique relative `outputPath` such as
   `computer-use-20260929-184500.jpg`.
   The Windows server starts with the active task workspace as its working
   directory.
2. Have the agent call UnrealCode's `ViewImage` on that relative filename.
   This requires a model that supports image input.
3. Review and remove captures from the project when finished. A screenshot can
   contain anything visible in that window and can otherwise be staged in Git.

Do not use inline base64 screenshots with 1.0.2: the app returns them as text
and applies a 1 MiB MCP result limit.

## What this does and does not add

| Works with the installed 1.0.2 client | Requires a future UnrealCode build |
| --- | --- |
| Host MCP connection, per-project tool grants, window and UI Automation tools | A built-in computer-use panel and automatic sidecar installation |
| Screenshot file in the active workspace followed by `ViewImage` | Direct forwarding of MCP image blocks to the model |
| Existing per-call MCP approval | Any different approval policy for computer actions |

This gives the agent window discovery, semantic UI inspection, click, type,
select, wait, keyboard, mouse, and screenshot tools without a new UnrealCode
release. The existing in-app browser remains the better path for web pages.

It is an optional, manually installed sidecar. UnrealCode 1.0.2 has no native
computer-use pane, no automatic sidecar installation, no direct MCP image
forwarding, and no way to remove the per-call approval requirement for MCP
tools. Those client features would require a later app build. The server's
`--tools` filter limits what it advertises; it is not a Windows sandbox.

If a connection fails, confirm the executable path, JSON argument syntax, host
trust, Docker/project selection, and current tool grants. If a tool definition
changes, reconnect and review it before selecting it again. Windows secure
desktop and elevated windows are outside this add-on's normal reach.
