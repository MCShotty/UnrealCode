# 1.0.1 replacement acceptance record

This is local candidate evidence from 2026-09-29. GitHub Actions blocked every
PR job before runner startup because of account billing. The owner explicitly
instructed us to bypass hosted checks and replace the private release with a
locally built, unattested installer. The original private 1.0.1 installer is archived locally with its
manifest, release metadata, annotated tag, and verified attestation record.

## Local checks

| Check | Observed result |
| --- | --- |
| TypeScript and desktop suite | `npm run typecheck` passed; 479 tests passed, 4 conditional skips. |
| Go | `go test ./...` passed in Go 1.27.1 Docker before packaging; focused changed-package race tests and `go vet ./cmd/... ./harness/... ./internal/...` passed. A later unscoped local vet traversed ignored `desktop/dist` backend copies, so source-root vet is the relevant result. |
| Docker | `Dockerfile.desktop` built `unrealcode:1.0.1-local`; bridge package checks passed. |
| Windows package | Unsigned NSIS candidate built (172,866,702 bytes); Authenticode reported `NotSigned`. Local candidate SHA-256: `3cceeb66aabe88e6375c444b8cf3dd12fdcaa53c6f6499ef252165926dcd8498`. This is not the future hosted artifact hash. |
| Packaged app | Hidden-window QA opened a disposable project, live shared browser tab and PDF. It verified origin grant, blocked redirect/frame escape, takeover, revocation, rendered page/search, bounded extraction, and English plus Arabic OCR data loading. |
| Agent team | Packaged fixture verified parallel workers, inherited restrictions, cancellation, conflict review/integration, queue ordering, restart, request limits, and usage totals. |
| Memory settings | Packaged fixture passed dark/light axe checks, short-window scrolling, and 200% scaling. Profile-switch rollback is covered by focused desktop tests. |
| Jev | Packaged live synthetic Noul request used `jev-1.13.0`; measured 313 input and 20 output tokens, with no renderer errors. BrowserDo fixture covers done, blocked, sign-in, uncertainty, confirmation, and action error. |
| Credential and notices | Packaged payload audit scanned 1,197 files, reviewed 223 installed dependency notices, compared seven available credential values, and found zero configured-pattern hits. |

The document tests cover project confinement, malformed and encrypted PDFs,
password handling, search, worker cancellation, and English OCR output. Arabic
language data loaded in the packaged app; character-level accuracy on an
Arabic document remains unmeasured. The packaged browser check uses a local
HTTP fixture; real third-party sign-in and consequential submissions are not
part of this safe regression run.

## Performance observation

`benchmark-bridge.mjs` compared a locally tagged prior image
`unrealcode:1.0.1-3db6b0967dae` with `unrealcode:1.0.1-local` over 12 synthetic
tasks each. The candidate also indexed a 100,000-event SQLite fixture during
its run. Median task time was **354.3 ms → 348.4 ms**, steering acknowledgement
**1.72 ms → 1.79 ms**, and independent tool overlap **279 ms → 271 ms**.
These are fixture observations, not evidence of a general speedup. The prior
image is a local tag, not an independently verified published baseline.
BrowserDo's focused fixture used two Jev decisions for an acted-and-verified
step, compared with zero for a direct browser action; no token-saving claim is
made.

## Release replacement boundary

PR #3 was merged into `main` at `948ce88f36588851a0449e983651a200801bf238`
under the owner's explicit bypass. Build the installer locally from merged
source, record its SHA-256, and label the release as **unattested**. Preserve
the archived original until the replacement installer and manifest are
uploaded and downloaded again. Restore the original tag and assets if cutover
fails. Mark the original checksum as superseded in the final verification
record.

The existing installation cannot notify users about a replacement with the
same version; installation is manual. Windows publisher signing and a fresh
machine check of the exact new installer remain outside this local record.
