# UnrealCode 1.0.4 release verification

Published on 2026-10-01 after [PR #7](https://github.com/MCShotty/UnrealCode/pull/7)
merged. The owner authorized this release. That authorization is fulfilled and
does not cover later versions or replacing published assets.

## Published identity

| Item | Verified value |
| --- | --- |
| Release | [UnrealCode 1.0.4](https://github.com/MCShotty/UnrealCode/releases/tag/v1.0.4) |
| Source commit | `7e39f002f91dc511772455b3f0425b507f14e3c6` |
| Annotated tag | `v1.0.4`, object `fb96c7b0e75296d32629dba1175f1434afd700f4` |
| Installer | `UnrealCode-Setup-1.0.4.exe`, 225,372,393 bytes |
| SHA-256 | `986DD892FA56FC57320781077A516D11FA3A621B8EA17727B11B614E69A4D521` |
| Authenticode | `NotSigned` |
| Release status | Public, stable, Latest |

The downloaded installer matches `SHA256SUMS` and GitHub's asset digest. GitHub
attestation verification binds the repository, release workflow, tag, exact
commit and hosted runner. Earlier 1.0.0 through 1.0.3 release asset identities,
digests and tag refs match the recorded pre-publication snapshot.

## Hosted checks

- [PR Windows and backend acceptance](https://github.com/MCShotty/UnrealCode/actions/runs/36798865637) passed on `f0428b6`.
- [PR Go, Harbor and four fuzz targets](https://github.com/MCShotty/UnrealCode/actions/runs/36798865620) passed on the same head.
- [Main Go checks](https://github.com/MCShotty/UnrealCode/actions/runs/36799854964) and [main desktop/backend acceptance](https://github.com/MCShotty/UnrealCode/actions/runs/36799855056) passed on the merged commit.
- [Exact-commit preflight](https://github.com/MCShotty/UnrealCode/actions/runs/36799859211) passed; publication was skipped.
- [Tagged build and publication](https://github.com/MCShotty/UnrealCode/actions/runs/36800569746) passed, including audits, packaged workflows, manifest verification, unsigned status and build attestation.

Three early Windows runs exposed fixture assumptions about native attachment
settlement and the hosted display size. The repaired fixtures retain their
assertions, add delayed attachment and narrow-dialog checks, and pass in the
final hosted runs. A duplicate branch-push acceptance run was cancelled after
the identical PR workflow passed. Cancellation is not counted as a pass.

## Verification and limits

Use [the verification commands](VERIFY_RELEASE.md) with this release's installer
and manifest. The [local acceptance record](ACCEPTANCE_1.0.4.md) contains the
571-pass desktop suite, six opt-in skips, fixture scopes and historical
performance evidence. Its local installer checksum differs from the published
bytes and must not be used for this download.

The installer is unsigned and upgrades remain manual. In-app release discovery
can announce 1.0.4 on its next check, but cannot download, install or restart it.
Model-authored stages are interpretations. Real native Computer, live populated
memory recovery, real model token overhead, fresh-machine installation and
screen-reader acceptance remain separate gates. Computer stays experimental
and off by default. Attestation proves build provenance, not Windows publisher
trust or absence of defects.
