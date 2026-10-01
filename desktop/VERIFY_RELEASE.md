# Verify an UnrealCode Windows release

Verify **1.0.4**. The installer is **not Authenticode signed**.
SHA-256 verifies downloaded bytes against the release manifest; GitHub Artifact
Attestations verify the hosted build's repository, workflow, tag and commit.
Neither establishes a trusted Windows publisher or removes SmartScreen warnings.

Download `UnrealCode-Setup-1.0.4.exe` and `SHA256SUMS` from the same
[GitHub release](https://github.com/MCShotty/UnrealCode/releases/tag/v1.0.4).
In PowerShell, from that download folder:

```powershell
$expected = (Get-Content .\SHA256SUMS -Raw).Trim() -split '  '
if ($expected.Count -ne 2 -or $expected[1] -ne 'UnrealCode-Setup-1.0.4.exe') {
    throw 'Unexpected SHA256SUMS format'
}
$actual = (Get-FileHash .\UnrealCode-Setup-1.0.4.exe -Algorithm SHA256).Hash
if ($actual -ne $expected[0]) { throw 'Installer checksum mismatch' }
```

With GitHub CLI installed, verify provenance against this repository and workflow:

```powershell
gh attestation verify .\UnrealCode-Setup-1.0.4.exe --repo MCShotty/UnrealCode --signer-workflow MCShotty/UnrealCode/.github/workflows/desktop-release.yml --source-ref refs/tags/v1.0.4 --deny-self-hosted-runners
```

For an exact commit check, fetch the tag in a clone of this repository, resolve
`git rev-parse 'v1.0.4^{commit}'`, and add that SHA with `--source-digest`.
The [release workflow](../.github/workflows/desktop-release.yml),
[packaging script](scripts/build-release.mjs), and
[checksum script](scripts/sha256-release.mjs) are public. A local candidate hash
can differ from the hosted installer; always use the manifest for your download.

If integrity or provenance verification fails, do not run the installer. Report
it using [SECURITY.md](../SECURITY.md). A passing result does not establish that
the software is free of defects.

## Updating an existing installation

Save buffers, settle active tasks, close UnrealCode, then run the verified
installer. Existing settings and history are preserved through normal migration
and recovery checks. Computer remains disabled by default; prior grants are not
restored automatically. Fieldnote originals work without memory enablement.

Unsigned updates require manual installation. Settings → Recovery → Application
updates supports release notifications, channel selection, manual checks and
an automatic-check toggle. Checks run when due after startup and at most daily;
notifications open GitHub and never download, execute or restart an installer.
Version 1.0.0 needs a manual upgrade to acquire release notifications.

## Historical 1.0.1 replacement

The same-version 1.0.1 replacement was built locally after GitHub Actions billing
blocked runner startup, under an explicit one-time owner authorization. It has
**no GitHub build attestation**. The original 1.0.1 attestation belongs only to its
archived installer. See the [replacement acceptance record](REPLACEMENT_ACCEPTANCE_1.0.1.md).
This exception does not apply to later releases; published earlier tags and assets remain
unchanged. Installing over the historical 1.0.1 replacement is a normal newer-version
manual upgrade.

## Local 1.0.4 acceptance build

The local acceptance build is distinct from hosted release bytes and has no
hosted build attestation.
Use its adjacent `SHA256SUMS` to check `UnrealCode-Setup-1.0.4.exe`. Confirm
Authenticode separately; this candidate is intentionally `NotSigned`. Its source
was the local `codex/timeline-density` working tree before the release commit.
See [the candidate report](ACCEPTANCE_1.0.4.md). Do not reuse the published 1.0.3
checksum for these bytes.
