# UnrealCode 1.0.3 acceptance record

Prepared 2026-09-30 from `codex/fieldnotes-computer`. This record distinguishes
local precommit checks from the later exact-commit hosted build and publication.
The owner authorized a new 1.0.3 release; earlier tags/assets remain preserved.

## Initial local precommit checks

- TypeScript: both renderer and main/preload configurations pass.
- Desktop: **523 passed, 6 explicitly skipped, 0 failed**, 529 total. Report:
  `.cache/release-103-tests.json`. Native and external acceptance remain opt-in.
- Secret-pattern and checksum-script regressions: 3 passed.
- Reachable Git-history audit before this release commit: 1,925 blobs,
  31,133,574 bytes, seven known local credential values, zero hits.
- Current source plus the previous local packaged payload audit: 1,426 files,
  223 installed npm packages, seven known credential values, zero hits.
  This is **not** a payload audit or checksum of the hosted 1.0.3 installer.
- QA scripts now honor `--packaged` explicitly, with syntax checks passing.
  Windows acceptance and release workflows include all four new packaged scripts.
- Jev semantic release review used `jev-1.13.0`, with raw focused evidence and
  probabilities retained privately in `.cache/jev-release-103-*.json`. It supports
  claim clarity and gate coverage; it does not replace tests or authorize release.
- The unrelated `docs/orbit-garden-demo.html` remains untracked and unchanged:
  `DA7F98618543892A937AAC6D33FAF6E8CF0C612686C50C4143000E3AAAB5C8A4`.

## Hosted release requirements

The first hosted Windows runs exposed a Computer startup QA failure. The actual
helper's readiness rejection was overwritten by a generic exit message. The
follow-up retains protocol/input-monitor/desktop/elevation diagnostics and rejects
unsafe or malformed readiness. Five new lifecycle regressions plus existing
Computer regressions pass (16 focused tests). A rebuilt local helper completes
the real protocol/ready/stop sequence in the offscreen source UI check. Hosted
tests now require the actual versioned handshake: a verified unsafe desktop
prerequisite must remain blocked, while a crash or incompatible helper fails.
This does not establish native input, and no safety check is bypassed for CI.

The PR must pass Windows desktop/packaged checks, Docker backend compatibility,
and Go race/vet/build CI. After merge, the build-only release workflow must pass
on the exact merged `main` commit before annotated tag `v1.0.3` is created.
The tagged workflow audits, builds and attests an unsigned installer, verifies
its provenance, and publishes it with `SHA256SUMS` and versioned release notes.
The downloaded published assets must be checked again against the manifest,
repository/workflow/ref/commit attestation, unsigned status and Latest designation.
No local candidate hash is substituted for the published hash.

## Explicit limitations

- Local Docker's Linux pipe was unavailable during this release preparation;
  hosted Docker/Go checks provide separate evidence.
- Windows currently exposes only desktop 1. No native clicks, typing, screenshots,
  physical takeover, lock/unlock, desktop transitions or mixed-DPI fixture ran.
  Computer is experimental and disabled by default. Authority tests and packaged
  helper startup do not establish real native-input or capture acceptance.
- Live Hindsight/model processing, populated recovery restoration, fresh-machine
  installation of 1.0.3 and full assistive-technology acceptance remain unverified.
- Earlier performance and Docker measurements in the
  [implementation record](../docs/FIELDNOTES_COMPUTER_IMPLEMENTATION.md) are dated
  evidence for earlier local candidates; they are not measurements of this artifact.
- Unsigned releases require manual installation. GitHub attestations do not confer
  Windows publisher trust. The historical unattested 1.0.1 replacement exception
  does not apply to this release.
