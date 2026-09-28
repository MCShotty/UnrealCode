# Published UnrealCode 1.0.1 verification

Verified on 2026-09-29 (Asia/Riyadh). GitHub publication time: 2026-09-28 22:42:25 UTC.

## Published identity

- [Release and changelog](https://github.com/MCShotty/UnrealCode/releases/tag/v1.0.1): stable, not a draft, and confirmed as GitHub's Latest release.
- Annotated tag: `v1.0.1`; tag object `23d0d5736b8848d19346f95a4421adba05b6df09`.
- Source commit: `05ad90458f201f8522b518f8c02650be0f1ab34a`, merged into `main` after [PR #1](https://github.com/MCShotty/UnrealCode/pull/1) and [PR #2](https://github.com/MCShotty/UnrealCode/pull/2) passed their checks.
- Installer: `UnrealCode-Setup-1.0.1.exe`, 142,494,011 bytes.
- Installer SHA-256: `5b0c6390527aecf93d3155c7398d1ebc21cf1884e10ace9360654cfa5a64e9e5`.
- `SHA256SUMS` asset SHA-256: `9894c3378d437014df393cb4d5a3e524a7f9a5fa82ea54b32c218292c0dd5f76`.
- Installer Authenticode status: **NotSigned**.

## Build and downloaded-asset verification

The [nonpublishing preflight](https://github.com/MCShotty/UnrealCode/actions/runs/36492958580) succeeded on the exact source commit above. The [tagged workflow](https://github.com/MCShotty/UnrealCode/actions/runs/36493471147) rebuilt from that tag, ran its gates, generated and verified the manifest, created and verified the GitHub Artifact Attestation, then published the two assets.

After publication, the installer and manifest were downloaded from the public release. The computed installer hash matched both the manifest and GitHub's asset digest. Authenticode inspection returned `NotSigned`. `gh attestation verify` succeeded with all of these restrictions:

```powershell
gh attestation verify .\UnrealCode-Setup-1.0.1.exe `
  --repo MCShotty/UnrealCode `
  --signer-workflow MCShotty/UnrealCode/.github/workflows/desktop-release.yml `
  --source-ref refs/tags/v1.0.1 `
  --source-digest 05ad90458f201f8522b518f8c02650be0f1ab34a `
  --deny-self-hosted-runners
```

The verified statement names this installer/hash, this repository and workflow, the release tag and source commit, and a GitHub-hosted runner. Hashes and attestations establish artifact integrity and provenance; they do not establish Windows publisher trust.

## Acceptance results and boundaries

- PR acceptance passed Windows packaging, backend Docker compatibility, Go on Linux/macOS, fuzzing and Harbor checks. Local Go race/vet and Docker workflow evidence is retained in [ACCEPTANCE_1.0.1.md](ACCEPTANCE_1.0.1.md).
- Tagged Windows desktop suite: **452 passed, 6 conditional skips**. The hosted runner lacked the optional browser runtime for three browser-boundary tests; two real-Docker recovery tests and the large-history benchmark are separately enabled suites. The earlier local desktop run passed **455 tests with 3 optional skips**. Do not present the hosted run as executing the skipped tests.
- TypeScript, production packaging, three checksum/secret-pattern fixture tests, packaged no-Docker/credential smoke, and the release-notification UI fixture passed.
- Tagged reachable-history audit: 1,725 blobs, 27,341,873 bytes, zero detected hits. Payload audit: 1,140 files, 207 dependency notices, zero detected hits. Hosted audits compared one available credential value; earlier local audits compared seven. These scans cover configured patterns and known credential values, not every possible secret format.
- Local notification checks covered opt-out/manual refresh, approved release URLs, unsigned download/install rejection, narrow light/dark rendering at 150% with reduced motion, preservation of other settings, and dismissal across restart. The disposable 1.0.0 profile upgrade preserved settings and canonical conversation history.
- Two failed acceptance attempts remain historical evidence: an asynchronous checkbox bounce was fixed, and offscreen screenshot capture now waits for rendered frames and retries only the transient compositor error. Required assertions were retained.

The published installer itself has not been independently installed on a fresh machine in this release operation. Earlier user-reported preview testing and disposable profile tests are distinct evidence. Visible native-desktop, full assistive-technology, and isolated matched-task memory-overhead acceptance remain limited as documented in the local record. The installer remains unsigned; downloads and installation are manual. Existing 1.0.0 users must manually install 1.0.1 before release notifications are available.

## Preserved release and source

The published v1.0.0 tag still resolves to `3f25c1bce449d3476639fc976778ced6955274d7`. Its installer asset ID `596086454` and checksum asset ID `596086462` are unchanged, as are their SHA-256 digests. No published tag or asset was replaced. The unrelated untracked `docs/orbit-garden-demo.html` was excluded from all commits.

This record and the final publication-status documentation are a documentation-only follow-up to the immutable release tag. They do not change the tagged application or installer. Future releases require separate authorization.
