# UnrealCode 1.0.0

UnrealCode is an open-source Windows desktop workspace for AI-assisted coding,
built on the Unreal Agent Go harness. It uses Docker Desktop's Linux engine for
project tools and persistent sessions. The application supports live steering,
parallel tools, Plan/Ask/Agent modes, change review, isolated Git worktrees,
optional specialist agents, MCP connections, local and API providers, measured
usage, and optional project memory.

## Download and verify

This release's Windows installer is **unsigned**. Windows may show **Unknown
publisher**. A SHA-256 manifest and GitHub build-provenance attestation accompany
the installer. Follow the [verification instructions](https://github.com/MCShotty/UnrealCode/blob/v1.0.0/desktop/VERIFY_RELEASE.md)
before installing. The attestation identifies the GitHub Actions workflow and
source tag that produced the installer; it is not Windows Authenticode signing.

UnrealCode's in-app updater remains disabled for unsigned builds. Install later
releases manually after verifying their own checksum and attestation.

## Requirements and limits

- Windows with Docker Desktop running its Linux container engine. Docker Desktop
  and model-provider accounts or local model runtimes are installed separately.
- The first trusted project opening builds the UnrealCode backend image locally
  from source bundled in the installer.
- Claude API is supported; Claude subscription login is not.
- Native Windows execution without Docker and macOS/Linux desktop packages are
  outside this release.

The source, public build workflow, audit scripts, dependency notices, privacy
policy, and security reporting instructions are in the
[repository](https://github.com/MCShotty/UnrealCode).
