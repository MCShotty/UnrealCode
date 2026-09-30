# Privacy and permissions

UnrealCode does not require its own cloud account or send project-operated usage telemetry. Your configured providers and services still receive data when you use them.

## Data destinations

- **Coding provider:** prompts, relevant history, selected context, attachments, and tool results.
- **Jev:** focused project text after project cloud consent. BrowserDo also needs exact-origin cloud consent and redacts focused descriptors.
- **Memory provider:** bounded retained outcomes, recall/reflect requests, activity excerpts, and saved Fieldnote interpretation after consent.
- **MCP server:** arguments, resources, and outputs of the approved connection.
- **Browser:** the origins you visit, with separate project sign-ins.
- **Computer model:** selected window text and requested captures under reviewed access.
- **GitHub:** release checks send no project content. GitHub operations use your existing host login.

PDF processing and selected-page OCR stay local. Documents are not automatically remembered. Unsaved Fieldnote drafts do not enter inference. Native-derived content is excluded from automatic memory.

## Permissions

Project trust, execution mode, tool approvals, MCP host trust, browser origins, and Computer window grants are separate decisions. A skill, note, memory, web page, tool description, or decision-model output cannot grant any of them.

Ask is the default. Agent works within existing permissions. Plan uses dedicated reading tools; an arbitrary command or MCP annotation is not proof of read-only behavior.

Approved container commands can change mounted files and contact the network. Windows MCP servers run with Windows account access. An approved signed-in browser origin can expose its page contents to the model.

Saved keys use Windows encryption when available and remain in Electron main. They are not put into Docker arguments or environment variables. Provider authentication and consent changes do not silently choose another provider.

Read [PRIVACY.md](https://github.com/MCShotty/UnrealCode/blob/main/PRIVACY.md) for the complete data policy. Report suspected bypasses privately using [SECURITY.md](https://github.com/MCShotty/UnrealCode/blob/main/SECURITY.md), without posting credentials or private content.
