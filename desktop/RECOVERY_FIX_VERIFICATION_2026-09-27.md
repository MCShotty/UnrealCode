# Recovery fix verification — 2026-09-27

## Changes

- Docker recovery export/import now use bounded, versioned stdio records rather
  than host backup bind mounts. Electron owns all host backup reads and writes,
  eliminating the different filesystem views behind the same Windows path.
- Streaming preserves binary contents and Unicode names, checks file sizes and
  SHA-256 digests, rejects incomplete streams, duplicates, links, unsupported
  roots and traversal, and bounds buffering and total entries/bytes.
- Restore still uses a new volume and resets saved execution mode, team flags,
  and local provider endpoints. Ownership is assigned after files are complete.
- Failed transfers remove their uniquely named helper containers; failed imports
  remove their newly created volumes. User session volumes are never replaced.
- Every export verifies its finalized directory before reporting success.
  Timestamp staging directories are allocated exclusively; failed copies remain
  available at the location reported in the error.
- Added a synthetic credential-context regression. Copying ciphertext without
  matching Local State is not used as evidence that a real credential is invalid.

The format-1 backup manifest remains unchanged and records files, not empty
directories. The transfer itself preserves empty directories. No new third-party
dependency, provider engine change, or execution/steering serialization was added.

## Passed

| Check | Result |
| --- | --- |
| TypeScript checks | Pass |
| Focused stream, recovery and migration tests | 39 passed |
| Desktop suite | 173 passed; 2 opt-in tests skipped |
| Opt-in real Docker regression | Passed separately: AppData export/finalization, migration, restore, binary/Unicode data, authority reset, rejected import cleanup, linked-file rejection |
| Recovery UI workflow using installed Electron runtime and current app build | Upgrade backup, durable session restore, credential exclusion, trust reset, stopped tasks after restart, redacted support output, damaged-profile preservation; no page errors |
| Synthetic credential-context UI regression | Missing context rejected; matching context decrypted; no real credentials used |
| Actual existing profile | Startup recovery clear; project/backend opened; previous chat preserved with 21 persisted events |
| Actual existing profile backup | Verified 27 files and 1 volume; settings equal to the pre-migration backup |
| Actual existing profile credentials | OpenRouter key available; encrypted secrets unchanged; no provider requests sent |
| Local NSIS package build | Completed with the workaround below; unsigned preview |
| Candidate credential/redistribution audit | 945 files scanned, 212 package notices checked, 7 local credential values compared in memory, no hits |

The existing profile's verified migration backup is recorded in
`storage-layout.json` and uses the UTC directory name
`2026-09-27_08-28-35.307Z`. Existing incomplete backups were retained rather than
silently marked valid or deleted.

## Windows build and launch limitations

Windows retained executable-image handles from exited earlier test processes in
the default output directory. The local candidate therefore lives in
`desktop/dist-recovery-fix/`, which is ignored by Git.

The temporary NSIS uninstaller generator stalled before producing its output.
Electron-builder's own binary extractor succeeded. The opt-in
`--extract-uninstaller` build flag uses that extractor for only the generated
helper; the normal signing step remains in place. The build used Windows system
certificate trust (`NODE_USE_SYSTEM_CA=1`), with TLS verification enabled.

Build command:

```powershell
$env:NODE_USE_SYSTEM_CA='1'
npm run build:win -- --output=dist-recovery-fix --extract-uninstaller
```

Automated launches of the newly packaged executable stalled before application
startup: each process had zero CPU time and one initially initialized thread.
Follow-up inspection found retained threads suspended and exact matching Avast
AutoSandbox records at the failed launch times. See
[packaged launch diagnosis](LAUNCH_DIAGNOSIS_2026-09-27.md) for the evidence and
remaining vendor-analysis uncertainty. The already-installed Electron 44.4.5
runtime starts successfully and passed the UI/profile checks above. These are
**not** claimed as successful direct packaged-executable smoke checks.

No installation, remote push, publication, or provider authentication request
was performed. The 1.0 release hold remains in force.

## Advisory semantic checks

TypeSafe `jev-latest` resolved to `jev-1.13.0`. The initial proposal check used
594 input / 52 output tokens; Noul results were transfer approach 0.63,
path/root validation 0.84, and credential-test interpretation 0.87.

Post-change checks used 6,073 input / 89 output tokens. The source check selected
“no host backup bind mounts” with probability/confidence 1.0. Noul results were
transfer-integrity rejection 0.92, restored-authority reset 0.88, and credential
boundary coverage 0.54. The last judgment lacked the separate environment-filter
implementation in its supplied excerpt, so it is not treated as a credential
audit. Runtime tests and the actual package audit supply the evidence above.
