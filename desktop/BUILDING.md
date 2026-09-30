# Building and releasing UnrealCode

## Windows development

Install Node.js 24+, Git, .NET SDK **10.0.401**, and Docker Desktop with its Linux engine. The backend
build uses the Go toolchain pinned in Dockerfile.desktop; host Go is optional.
From `desktop/` run:

```powershell
npm ci
npm run typecheck
npm test
npm run dev
```

The app uses an existing external Codex login, API credentials entered in Settings,
or a selected local endpoint. No key is required to compile or run fixture tests.
`UNREAL_DESKTOP_USER_DATA` selects an isolated profile for testing.
`UNREAL_DESKTOP_BACKGROUND_CHECK=1` uses offscreen rendering only when that isolated
profile is set. It does not establish native-window or fresh-machine acceptance.
Offscreen fixtures suppress automatic release-network checks; notification tests
exercise the scheduler with fake time and intercept GitHub responses in the
packaged app. No GitHub token or model credential is needed for these fixtures.

`predev`, `pretest`, and `prebuild:code` build `cmd/unrealcode-host-files` with
host Go or the pinned Go Docker image. This small native helper performs host
project and recovery I/O through directory handles; checking a path and reopening
it from Node does not protect against junction swaps. Its binary is bundled under
`resources/host-files`, requires no provider credentials, and processes independent
requests concurrently. Missing helpers fail closed with rebuild/reinstall guidance.
Hard-linked files are rejected. ReFS is currently unsupported because Node's
64-bit inode cannot authenticate the full ReFS file identity; use NTFS.

`predev` and `prebuild:code` also run `computer:build`. This restores locked NuGet
dependencies and publishes a self-contained Windows x64 helper from
`desktop/computer-host` and the pinned source in `third_party/windows-mcp`.
Users do not need .NET installed. The public build records source and executable
SHA-256 hashes in `generated/computer-host/manifest.json`; Electron verifies the
executable before starting it. `--self-test` exercises authority without native
input. `computer-notices.mjs` audits the installed dependency/runtime licenses;
regenerate notices before packaging. No MCP endpoint or provider key is passed
through the helper environment.

Fieldnotes/Computer checks (from `desktop/`):

```powershell
npm run computer:build
node scripts/qa-reliability.mjs
node scripts/qa-fieldnotes.mjs
node scripts/qa-computer.mjs
$env:UNREAL_FIELDNOTES_BENCHMARK='1'; npm exec vitest run src/main/fieldnotes.benchmark.test.ts
```

The native acceptance test is separately gated by `UNREAL_COMPUTER_NATIVE=1` and
requires virtual desktop 2 active and idle, with the disposable
`tests/computer-fixture` window running. It verifies typing, a reviewed fixture
file save, selected-window capture, and stop/revocation. It does not target user
applications. Offscreen UI checks do not establish mixed-DPI, lock/unlock, physical
takeover, or real-application acceptance. Keep those gates explicit.

## Windows candidate

```powershell
npm run build:win
node scripts/audit-release.mjs
node scripts/audit-history.mjs
node scripts/qa-recovery.mjs --packaged
node scripts/qa-credential-context.mjs --packaged
node scripts/qa-branding.mjs --packaged
node scripts/qa-accessibility.mjs --packaged
node scripts/qa-teams.mjs --packaged
node scripts/qa-verification.mjs --packaged
node scripts/qa-connections.mjs --packaged
node scripts/qa-coding.mjs --packaged
node scripts/qa-workflow.mjs --packaged
node scripts/qa-diagnostics.mjs --packaged
```

For a separate local candidate when Windows retains a lock on a previous test
executable, use `npm run build:win -- --output=dist-recovery-fix`. The release audit,
recovery QA, and credential-context QA accept `UNREALCODE_QA_EXECUTABLE` pointing to that candidate's
`win-unpacked/UnrealCode.exe`. These options do not publish anything. If a build
download needs certificates installed in Windows, set `NODE_USE_SYSTEM_CA=1`;
do not disable TLS verification.

If Windows stalls the temporary NSIS uninstaller-generation executable, append
`--extract-uninstaller` to the build command. This narrowly uses electron-builder's
own binary extractor for that helper; the normal signing step remains enabled.

The real Docker recovery regression is opt-in: set `UNREAL_TEST_DOCKER=1` and run
`npx vitest run src/main/recovery-volumes.integration.test.ts` after building a
backend image. It uses disposable app-data folders and volumes and checks the
Windows redirected-path case, finalization, migration, restore, and failed-transfer
cleanup. Credential-context QA uses synthetic keys only.

Run the Go race suite and vet in the pinned toolchain. Use synthetic providers
for automated acceptance; live checks require existing credentials and are
reported separately. The installer includes source used to build the Docker
backend locally. Docker Desktop, external CLIs and model weights are not bundled.

## Public unsigned distribution

The owner chose an unsigned Windows 1.0 release with SHA-256 hashes, a Git tag,
GitHub Artifact Attestations, and public build scripts. Build locally with:

```powershell
npm run build:release:unsigned
node scripts/audit-release.mjs
node scripts/sha256-release.mjs --write
node scripts/sha256-release.mjs --verify
```

For a locked previous local `dist/win-unpacked` folder, build with
`npm run build:release:unsigned -- --output=dist-release-test` and set
`UNREALCODE_RELEASE_OUTPUT=dist-release-test` for the checksum script. The
hosted workflow always uses a fresh default `dist` directory.

This explicit build mode rejects signing environment variables and disables
automatic certificate discovery. The [public release workflow](../.github/workflows/desktop-release.yml)
runs the tests and audits again on GitHub's Windows runner, checks that the NSIS
installer is unsigned, generates and verifies its checksum, creates and verifies
an attestation for the exact source ref, and uploads only the installer and
`SHA256SUMS`. The workflow can be dispatched on `main` for a nonpublishing
preflight; publication occurs only from a matching `v1.*` Git tag. Follow
[VERIFY_RELEASE.md](VERIFY_RELEASE.md) after downloading release assets.

Unsigned builds deliberately keep the in-app updater unavailable. Future
updates must be installed manually after verifying each release. An attestation
proves build origin and integrity; it is not a Windows publisher signature.

## Future signed distribution

Set `UNREALCODE_PUBLISHER` to the certificate's actual Windows publisher name and
configure electron-builder's supported signing credentials in the build system.
Keep signing material outside this repository. `npm run build:stable` requires a
publisher and uses `forceCodeSigning`; never substitute a self-signed certificate
and call the result a stable public release.

Inspect Authenticode signatures on both the installed executable and installer.
Publish the installer, blockmap and channel metadata produced by electron-builder
together. Stable uses `latest`; preview uses `preview` and prerelease metadata.
The public update feed is fixed to MCShotty/UnrealCode. No account token is embedded.
The app disables automatic downloads and install-on-quit. Explicit restart checks
active work, saves a recovery backup, and rechecks the installer hash and publisher.

Unsigned candidates deliberately show updates as unavailable.

## Final release gates

Record fresh-machine install, upgrade from supported 0.x profiles, failed migration
recovery, backup restoration, long-session stability, scaling, keyboard/screen-reader
checks and all theme variants. Hosted CI and local acceptance are separate evidence;
a runner that never starts has not passed. Audit all reachable Git history and the
release payload before publishing. Keep upstream MIT attribution and dependency
notices. Do not claim unsigned distribution covers signed-update or invalid-signature
acceptance; those features remain unavailable until a trusted signer exists.
