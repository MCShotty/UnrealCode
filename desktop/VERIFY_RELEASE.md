# Verify an UnrealCode Windows release

UnrealCode 1.0.1 is **not Authenticode signed**. These steps compare the installer
with the SHA-256 manifest published on GitHub. The corrected same-version 1.0.1
replacement was built locally after GitHub Actions billing blocked runner startup;
it has **no GitHub Artifact Attestation**. These checks do not make
Windows display a verified publisher or eliminate SmartScreen warnings.

Download `UnrealCode-Setup-1.0.1.exe` and `SHA256SUMS` from the same
[GitHub release](https://github.com/MCShotty/UnrealCode/releases/tag/v1.0.1).
In PowerShell, from the download folder:

```powershell
$expected = (Get-Content .\SHA256SUMS -Raw).Trim() -split '  '
if ($expected.Count -ne 2 -or $expected[1] -ne 'UnrealCode-Setup-1.0.1.exe') {
    throw 'Unexpected SHA256SUMS format'
}
$actual = (Get-FileHash .\UnrealCode-Setup-1.0.1.exe -Algorithm SHA256).Hash
if ($actual -ne $expected[0]) { throw 'Installer checksum mismatch' }
```

The normal release workflow builds from a Git tag, runs tests and audits, and
creates an attestation. It could not run for this replacement. The published
[workflow](../.github/workflows/desktop-release.yml),
[packaging script](scripts/build-release.mjs), and
[checksum script](scripts/sha256-release.mjs) show the build procedure. The
[replacement acceptance record](REPLACEMENT_ACCEPTANCE_1.0.1.md) documents
local tests and the bypass. The original 1.0.1 release's attestation applies
only to its archived installer, **not** to the replacement.

A matching hash establishes integrity relative to the downloaded manifest;
it does not prove who built the installer or that it is free of defects. If
the checksum verification fails, do not run the installer; report it using
[SECURITY.md](../SECURITY.md).

## Updating an existing installation

Close UnrealCode after saving buffers and settling active tasks, then run the verified installer. Version 1.0.0 needs this manual upgrade to acquire release notifications. An earlier private 1.0.1 installation also requires manual reinstall of the corrected 1.0.1 release; its version string is unchanged and cannot trigger a newer-version notice. Version 1.0.1 checks GitHub when due after startup and once daily by default; this private repository may require the existing host `gh` login. Notifications open the release/changelog page and do not install an executable. The signature checks for automatic installation remain in place.

A local candidate checksum may differ from the published replacement. Always compare against the manifest attached to the release you downloaded.
