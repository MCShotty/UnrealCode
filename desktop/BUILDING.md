# Building and releasing UnrealCode

## Windows development

Install Node.js 24+, Git, and Docker Desktop with its Linux engine. The backend
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

## Windows candidate

```powershell
npm run build:win
node scripts/audit-release.mjs
node scripts/audit-history.mjs
node scripts/qa-recovery.mjs --packaged
node scripts/qa-teams.mjs --packaged
node scripts/qa-verification.mjs --packaged
node scripts/qa-connections.mjs --packaged
node scripts/qa-coding.mjs --packaged
node scripts/qa-workflow.mjs --packaged
node scripts/qa-diagnostics.mjs --packaged
```

Run the Go race suite and vet in the pinned toolchain. Use synthetic providers
for automated acceptance; live checks require existing credentials and are
reported separately. The installer includes source used to build the Docker
backend locally. Docker Desktop, external CLIs and model weights are not bundled.

## Signed distribution

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

Unsigned candidates deliberately show updates as unavailable. Private-repository
distribution is manual until public visibility and signed release gates pass.

## Final release gates

Record fresh-machine install, upgrade from supported 0.x profiles, failed migration
recovery, interrupted download, invalid signatures, backup restoration, long-session
stability, scaling, keyboard/screen-reader checks and all theme variants. Hosted CI
and local acceptance are separate evidence; a runner that never starts has not passed.
Audit all reachable Git history and all retained release assets before changing
repository visibility. Keep upstream MIT attribution and dependency notices.
