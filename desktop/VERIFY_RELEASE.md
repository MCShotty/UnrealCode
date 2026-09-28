# Verify an UnrealCode Windows release

UnrealCode 1.0.0 is **not Authenticode signed**. These checks verify the bytes
published on GitHub and the GitHub Actions build provenance. They do not make
Windows display a verified publisher or eliminate SmartScreen warnings.

Download `UnrealCode-Setup-1.0.0.exe` and `SHA256SUMS` from the same
[GitHub release](https://github.com/MCShotty/UnrealCode/releases/tag/v1.0.0).
In PowerShell, from the download folder:

```powershell
$expected = (Get-Content .\SHA256SUMS -Raw).Trim() -split '  '
if ($expected.Count -ne 2 -or $expected[1] -ne 'UnrealCode-Setup-1.0.0.exe') {
    throw 'Unexpected SHA256SUMS format'
}
$actual = (Get-FileHash .\UnrealCode-Setup-1.0.0.exe -Algorithm SHA256).Hash
if ($actual -ne $expected[0]) { throw 'Installer checksum mismatch' }
```

With the [GitHub CLI](https://cli.github.com/) installed, verify that the same
installer was attested by this repository's release workflow from the exact tag:

```powershell
gh attestation verify .\UnrealCode-Setup-1.0.0.exe `
  -R MCShotty/UnrealCode `
  --signer-workflow MCShotty/UnrealCode/.github/workflows/desktop-release.yml `
  --source-ref refs/tags/v1.0.0 `
  --deny-self-hosted-runners
```

The release workflow builds the installer from the public Git tag, runs tests
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
