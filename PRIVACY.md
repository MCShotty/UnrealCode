# UnrealCode privacy and data flows

UnrealCode is a local Windows desktop application. It does not require an
UnrealCode-hosted account or send usage telemetry to a service operated by this
project. It stores preferences and its rebuildable history index in the Windows
app profile; the Unreal Agent backend stores canonical sessions in Docker
volumes. A trusted project folder can be mounted into its local container.

## When data can leave the computer

- **Selected model provider:** Starting or continuing a task sends prompts and
  relevant conversation, selected context, attachments, and tool results to the
  provider or endpoint you chose. An active agent may make further requests until
  the task settles or you stop it. A local endpoint remains local only if that
  endpoint itself does not forward requests.
- **Optional decision model:** TypeSafe receives focused project text only after
  the project's cloud-decision consent. BrowserDo additionally needs an exact
  web-origin cloud consent before it sends bounded, redacted page descriptors.
  Password inputs, hidden fields, cookies and supplied browser values are
  excluded from those descriptors; token-like visible text is conservatively
  omitted or redacted. Other visible page content can still be sent after you
  grant the origin. Laya and GLiNER run locally when enabled.
- **Optional app-wide memory:** Hindsight and its database run in local Docker
  containers. After you accept the scope and separately selected model destination,
  that provider can receive bounded task outcomes, corrections, recall/reflect
  requests, and redacted chat/tool/activity excerpts for timeline summaries.
  Relevant retained knowledge can be recalled across trusted projects with source
  attribution. Unintegrated specialist findings remain task-scoped. Existing
  project memories migrate after consent; historical chats are not all ingested.
- **Connections and browser:** Enabled MCP servers receive the arguments and
  resources passed to their tools. The live project browser contacts visited
  origins, stores sign-ins in a separate Electron partition per project, and
  gives the agent no access until exact observation/interaction origins are
  granted and a tab is handed back. A granted origin can expose a signed-in page.
  Specialist browser profiles remain isolated. Browser cookies are excluded from
  ordinary recovery exports and support bundles. Windows-hosted MCP servers run
  with the Windows account's access; review their permissions before connecting.
- **Documents:** The PDF reader and English/Arabic OCR run locally in workers.
  PDF text is not automatically added to memory or sent to a model. An agent may
  read trusted-project PDFs or an external PDF explicitly attached to its chat.
  OCR language data downloads on demand from a pinned upstream commit and is
  checked against bundled SHA-256 values before use.
- **GitHub and usage reports:** Git and `gh` contact GitHub for actions you
  select or authorize. Optional provider-organization reports contact that
  provider using the separate admin credential you configure.
- **Setup and updates:** Explicit backend/legacy-browser/model preparation can
  download images or model files from their upstream hosts. Release notifications
  first contact GitHub's API anonymously; for this private repository, a 404 may
  cause Electron main to use the existing host `gh` login for that GitHub request.
  The token stays out of the renderer, Docker and saved notification cache. Checks
  run when due after startup and at most daily, or when requested; they can be
  disabled in Settings → Recovery. They send no project or conversation content.
  Downloading and installation remain manual for unsigned builds.

The app does not control how a selected model provider, MCP server, website, or
repository host retains or uses data after receiving it. Review the applicable
service terms before sending private project content. Provider policies include
[OpenAI](https://openai.com/policies/),
[Anthropic](https://www.anthropic.com/legal/privacy),
[OpenRouter](https://openrouter.ai/privacy/),
[Fireworks](https://fireworks.ai/privacy-policy),
[TypeSafe](https://typesafe.ai/legal/privacy-policy), and
[GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
Custom model and MCP endpoints have their own operators and policies.

## Local controls and exports

Saved provider API keys stay in Electron's main process and are encrypted with
Windows-backed Electron storage when available; otherwise keys remain in memory
for that run. The backend receives credentials in memory, not in Docker command
arguments or environment variables. The app does not export saved credentials
or external login files in a normal recovery backup.

You can stop tasks, revoke project or connection grants, change providers,
disable decision and memory features, and review included context. Context
exclusions control retrieval, not filesystem access. Recovery exports and
project snapshots can contain conversation text and source files: inspect them
and keep them private. Support bundles show a redacted preview before export
and exclude credentials and project content by default.

For security concerns, use the [private reporting path](SECURITY.md).
