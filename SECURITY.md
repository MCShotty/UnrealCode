# Security reporting

Report suspected credential exposure or permission bypass privately through
[GitHub private vulnerability reporting](https://github.com/MCShotty/UnrealCode/security/advisories/new).
If that feature is unavailable, open an issue requesting a private contact without
including the exploit, credentials, project content or personal information.

Include the app version, Windows/Docker versions, the affected execution mode,
steps using a disposable project, expected behavior and observed behavior.
The Settings support bundle excludes project content and credentials; preview it
before attaching it. Do not attach recovery backups to public reports.

## Boundaries

- Project trust allows the selected folder to be mounted in a local container.
  Approved commands can access that folder and the container network. Docker is
  not a guarantee that executing unfamiliar code is harmless.
- Windows-hosted MCP servers run with your Windows account's access. Their trust
  grant is separate from the project container and from individual tool approvals.
- Plan mode exposes dedicated read/search tools. Arbitrary commands and MCP
  annotations do not establish read-only behavior. Decision outputs are advisory.
- Credentials are retained in Electron main, with saved keys encrypted using
  Windows when available. Provider credentials reach the backend only in memory.
- Recovery exports include conversation and owned project snapshots, which may
  contain sensitive user-provided text. Credential vaults and external logins are
  excluded; keep recovery exports private.

Stable 1.0 publication requires signed distribution, credential/dependency audits,
recovery and fresh-install acceptance. Release candidates are not a stable sign-off.
