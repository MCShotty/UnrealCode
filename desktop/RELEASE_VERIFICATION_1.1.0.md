# UnrealCode 1.1.0 release verification

Published on 2026-10-02 after [PR #8](https://github.com/MCShotty/UnrealCode/pull/8)
merged. The owner's authorization is fulfilled. It does not cover later releases
or replacement of published tags or assets.

## Published identity

| Item | Verified value |
| --- | --- |
| Release | [UnrealCode 1.1.0](https://github.com/MCShotty/UnrealCode/releases/tag/v1.1.0) |
| Source commit | `246fdbf4e0910ab6cd46ad0c307f5dfe3e648a68` |
| Annotated tag | `v1.1.0`, object `6eeb3961de2b7dbd64dce907de7a005c9a1c6b5c` |
| Installer | `UnrealCode-Setup-1.1.0.exe`, 225,397,100 bytes |
| SHA-256 | `647C79B11E1FD093BA8AEC827BE8EF2625704BFE14044936DD41D568B0AF6CF1` |
| Authenticode | `NotSigned` |
| Release status | Public, stable, Latest at verification |

The downloaded installer matches `SHA256SUMS`, GitHub's asset digest and its
1.1.0 version resource. Attestation verification binds the repository, release
workflow, tag, exact source commit and hosted runner. Earlier release IDs, asset
IDs, names, sizes, digests and remote tag refs match the pre-publication snapshot.
The unrelated untracked demo is unchanged.

## Hosted checks

- [PR Windows and Docker/backend acceptance](https://github.com/MCShotty/UnrealCode/actions/runs/36943415118) passed on `6538f74`.
- [PR Go, Harbor and four fuzz targets](https://github.com/MCShotty/UnrealCode/actions/runs/36943415057) passed on the same head.
- [Main Go checks](https://github.com/MCShotty/UnrealCode/actions/runs/36944297220) and [main desktop/backend acceptance](https://github.com/MCShotty/UnrealCode/actions/runs/36944297141) passed on the merged source.
- [Exact-commit release preflight](https://github.com/MCShotty/UnrealCode/actions/runs/36944302150) passed, including packaging, audits, checksum and attestation verification. Publication was skipped.
- [Tagged build and publication](https://github.com/MCShotty/UnrealCode/actions/runs/36945053894) passed. The publish job verified its downloaded installer and attestation before creating the release.

The hosted desktop suite reports 580 passes, nine skips and no failures.
Three browser-boundary tests need Playwright Chromium, which was absent on the
hosted runner; they passed in the local suite. The remaining six skips are
opt-in native, OCR, recovery and benchmark checks. Packaged Electron browser,
documents, reliability, Fieldnotes, Computer startup, notifications, timeline
and UI-race workflows passed separately. Skips are not counted as passes.

The [implementation record](../docs/ASYNC_EXECUTION.md) distinguishes the
583-pass local suite, fixture scopes, rollback contracts and historical local
installer hashes. Those hashes do not identify this published download.

## Installation and limits

Use [the verification commands](VERIFY_RELEASE.md) with this release's installer
and manifest. Installation is unsigned and manual. In-app notifications can
announce the newer release, but cannot download, install or restart it.

Older binaries cannot read the new advisory input kind. Before rollback, preserve
the current profile and session volumes. Restore a verified earlier snapshot
deliberately and retain newer history separately. Never replay completed tools
automatically.

Real native Computer, populated Hindsight recovery, account-specific live
providers, a populated 1.0.4-profile upgrade, fresh-machine installation and
assistive-technology acceptance remain separate gates. Fixture results do not
establish those behaviors. Attestation proves build provenance, not Windows
publisher trust or absence of defects. No measured efficiency claim is made.
