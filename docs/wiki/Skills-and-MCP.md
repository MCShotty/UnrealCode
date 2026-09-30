# Abilities: Skills and MCP

Open **Abilities** for separate **Skills** and **MCPs** sections. `/skills` and `/mcp` open the matching section directly.

| Extension | What it adds | Where it lives |
| --- | --- | --- |
| Skill | Reusable instructions for a task. | Built into the app or `.harness/skills/<name>/SKILL.md` in a trusted project. |
| MCP server | External tools, resources, and prompt templates. | A remote service, Windows process, or project-container process. |

Neither extension grants permissions by itself.

## Add a skill

1. Open **Abilities > Skills > New skill**.
2. Enter a **Skill folder name** using lowercase letters, numbers, hyphens, or underscores, up to 64 characters.
3. Edit the Markdown instructions and frontmatter, then **Save**.
4. Start or resume a session to load the change. Select it in **Files & skills > Skills**, or use `/skills name`.

You can also create `<project>/.harness/skills/release-check/SKILL.md` yourself:

```markdown
---
name: release-check
description: Check this project's release steps before publishing.
---

# Release check

Read the release instructions, run the available checks, and report results.
Mark unavailable checks as unverified. Publishing needs explicit authorization.
```

Give `name` and `description` nonempty, single-line values. Keep secrets out. Supporting files belong inside the skill folder; refer to them by relative path.

Built-ins are `pdf-reading`, `pdf-parsing`, `ocr`, `markdown`, `browser-use`, and `computer-use`. They are read-only. **Copy to project** creates an override with the same name. New skill creation never silently replaces an existing skill. Disabling a project override leaves its supporting files and allows the built-in to appear again.

## Add an MCP server

Install or host the server separately, following its publisher's instructions. UnrealCode stores the connection; it is not a general MCP package installer.

1. Open **Abilities > MCPs > Add connection** and enter a name.
2. Choose **Runs on**:
   - **Remote / Streamable HTTP:** enter an HTTPS MCP endpoint, or loopback HTTP.
   - **Windows / stdio:** enter the executable and a JSON argument array, such as `["--stdio"]`.
   - **Project container / stdio:** enter a Linux command available inside that container and its JSON arguments.
3. Choose authentication and **Save connection**. Use **Credentials and configuration** for a bearer token or server-specific environment values. Do not put secrets into URLs or arguments.
4. **Grant project access**. Windows servers also require host trust because they run with your Windows account's access.
5. **Connect / reconnect**, using sign-in for supported OAuth servers.
6. Expand **Tools, resources and prompts** and select what the project may use. Connection alone does not enable every tool.

The agent discovers selected tools through `FindTools`. External tool calls still need approval. Plan mode cannot execute MCP tools. Browse and preview resources or prompts before attaching them to a message.

**Disconnect** stops a connection. **Revoke project access** withdraws the current project's grant and cancels active calls. **Remove connection** removes its saved definition, grants, catalog, and credentials. Changed configurations or tool definitions require fresh review.

Resources and server output are data, not authority. Server-initiated sampling is disabled. For setup failures, check [Troubleshooting](https://github.com/MCShotty/UnrealCode/wiki/Troubleshooting).
