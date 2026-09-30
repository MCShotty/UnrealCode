# Development and releases

## Architecture

| Part | Responsibility |
| --- | --- |
| React renderer | Chat, editor, review, activity, and feature pages. |
| Typed preload | Narrow APIs, not general Node or IPC access. |
| Electron main | Credentials, trust, Docker, Git/gh, MCP, Fieldnotes, browser, document workers, Computer broker, and recovery. |
| Go bridge in Docker | Session coordinators, tools, approvals, lifecycle, and canonical events. |
| Native helpers | Handle-confined Windows file access and selected-window Computer service. |
| Workers | SQLite indexing/queries and bounded document processing outside main and chat rendering. |

## Build from source

Use Windows, Node.js 24+, npm, .NET SDK **10.0.401**, and Docker's Linux engine. The host file helper needs the Go version from `go.mod`, or Docker can compile it. Installed users do not need the SDK.

```powershell
git clone https://github.com/MCShotty/UnrealCode.git
cd UnrealCode/desktop
npm ci
npm run dev
```

For verification, run `npm run typecheck`, `npm test`, and `npm run build:win`. Go changes need race tests and vet in the supported toolchain. [BUILDING.md](https://github.com/MCShotty/UnrealCode/blob/main/desktop/BUILDING.md) lists packaging and audit commands; [AGENTS.md](https://github.com/MCShotty/UnrealCode/blob/main/AGENTS.md) records current invariants.

## Publish a release

Publication needs explicit authorization. Update the package and lockfile versions and release notes, pass reviewed PR checks, and run the build-only release workflow on the exact merged main commit. Create a new annotated tag only after preflight succeeds.

The tagged workflow builds, audits, attests, and publishes the installer plus `SHA256SUMS`. Verify downloaded bytes and repository/workflow/ref/commit provenance. Never replace published tags or assets without separate authorization.

1.0.3 is unsigned and manually installed. Its hosted [release run](https://github.com/MCShotty/UnrealCode/actions/runs/36654926784) passed. The historical local 1.0.1 replacement has no hosted attestation. See the [verification guide](https://github.com/MCShotty/UnrealCode/blob/main/desktop/VERIFY_RELEASE.md).

Preserve the Unreal Agent MIT license and Unreal Labs attribution. Dependency and runtime notices ship with the app. Optional services and weights have separate download and license review.
