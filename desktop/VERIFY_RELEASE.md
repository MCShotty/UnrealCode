# Verify an UnrealCode Windows release

UnrealCode 1.0.1 is **not Authenticode signed**. These checks verify the bytes
published on GitHub and the GitHub Actions build provenance. They do not make
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

With the [GitHub CLI](https://cli.github.com/) installed, verify that the same
installer was attested by this repository's release workflow from the exact tag:

```powershell
gh attestation verify .\UnrealCode-Setup-1.0.1.exe `
  -R MCShotty/UnrealCode `
  --signer-workflow MCShotty/UnrealCode/.github/workflows/desktop-release.yml `
  --source-ref refs/tags/v1.0.1 `
  --deny-self-hosted-runners
```

The release workflow builds the installer from the repository Git tag, runs tests
and credential/license audits, writes `SHA256SUMS`, creates the attestation,
then verifies both before uploading the release. The published
[workflow](../.github/workflows/desktop-release.yml),
[packaging script](scripts/build-release.mjs), and
[checksum script](scripts/sha256-release.mjs) show the exact procedure.

A matching hash alone establishes integrity relative to the downloaded
manifest. The attestation adds a cryptographically verifiable claim about the
GitHub repository, workflow, and source ref. Neither is a Windows code-signing
certificate or a guarantee that the program is free of defects. If either
verification fails, do not run the installer; report the discrepancy using
[SECURITY.md](../SECURITY.md).

## Updating an existing installation

Close UnrealCode after saving buffers and settling active tasks, then run the verified installer. Version 1.0.0 needs this manual upgrade to acquire release notifications. An earlier private 1.0.1 installation also requires manual reinstall of the corrected 1.0.1 release; its version string is unchanged and cannot trigger a newer-version notice. Version 1.0.1 checks GitHub when due after startup and once daily by default; this private repository may require the existing host `gh` login. Notifications open the release/changelog page and do not install an executable. The signature checks for automatic installation remain in place.

A local candidate checksum is not the checksum of the GitHub-built release. Always compare against the manifest attached to the release you downloaded.
