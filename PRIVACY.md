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
  the project's cloud-decision consent. Laya and GLiNER run locally when enabled.
- **Optional long-term memory:** Hindsight and its database run in local Docker
  containers. If you enable project memory, its separately selected inference
  provider can receive bounded retained facts and recall/reflect requests.
- **Connections and browser:** Enabled MCP servers receive the arguments and
  resources passed to their tools. Browser navigation and interactions contact
  the visited origins. Windows-hosted MCP servers run with the Windows account's
  access; review their permissions and privacy policies before connecting.
- **GitHub and usage reports:** Git and `gh` contact GitHub for actions you
  select or authorize. Optional provider-organization reports contact that
  provider using the separate admin credential you configure.
- **Setup and updates:** Explicit backend/browser/model preparation can download
  images or model files from their upstream hosts. Update checks contact the
  configured GitHub release feed when requested.

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
