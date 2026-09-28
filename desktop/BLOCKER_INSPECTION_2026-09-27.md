# Workflow blocker inspection — 2026-09-27

Follow-up: the recovery transfer fix has been implemented locally. See
[recovery fix verification](RECOVERY_FIX_VERIFICATION_2026-09-27.md) for current
results and the remaining packaged-executable launch limitation. The inspection
below records the original diagnosis before those changes.

Scope: inspect the startup recovery blocker and the reported OpenRouter
credential-loading failure. No application source changes, provider requests,
configuration changes, Git pushes, or releases were performed.

## Confirmed: backup paths split under Windows package virtualization

The Linux Docker daemon is available (`linux/29.8.0`). The failing backup is
not currently waiting for Docker and the source volume's marker exists.

Native `GetFinalPathNameByHandleW` inspection located:

- The completed backup's manifest beneath the Codex package's
  `LocalCache/Roaming/UnrealCode/recovery` directory.
- The corresponding missing `.unrealcode-migrated` file beneath ordinary
  `AppData/Roaming/UnrealCode/recovery`, still in the original `.partial` directory.

This is a mismatch between the filesystem view inherited by processes launched
from Codex and the host filesystem view used by Docker. Windows merges those
locations for reads, but the final directory rename does not move both trees.
The result passes pre-rename inventory and fails post-rename verification.

### Controlled reproduction

A disposable app-data directory was populated with metadata using Windows
filesystem calls and one sentinel using a Docker bind mount. No user project,
session volume, or configuration was used as fixture data.

| Docker bind source | Sentinel before rename | Sentinel in completed backup | Sentinel left in partial |
| --- | --- | --- | --- |
| Logical app-data path, matching current code | Present | Missing | Present |
| Physical directory obtained from a Windows file handle | Present | Present | Absent |

The experiment used one sequential process, so concurrent backups are not
required to trigger the failure. The fixture was removed from both physical
locations afterward. This verifies the cause in the current launch environment;
it does not establish that an ordinary standalone launch has the same problem.

### Affected code and correction

- `src/main/recovery-volumes.ts:21` passes the logical host path directly into
  Docker's bind mount.
- `src/main/recovery.ts:46-47` inventories the merged staging view and then
  renames the directory.
- `src/main/recovery.ts:113` verifies the finalized export during migration,
  correctly rejecting its missing files.

Make Docker transfer and Electron filesystem operations use the same physical
destination. A platform-independent approach is to stream the volume export
through Docker stdout and write it using Electron-owned filesystem operations,
with bounded streaming, path validation, and integrity checks. Resolving a
Windows mount path through a native file handle also passed the control test;
ordinary `realpath` did not expose this redirection during inspection.

Keep final verification. Do not mark existing split backups complete or bypass
the migration gate. Re-export and verify after correcting the transfer path;
retain old copies until recovery is established. Import needs the same
cross-process path review. These changes have not yet been implemented.

Microsoft's documented behavior:
https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization

## Cleared: copied-profile OpenRouter decryption failure

The earlier disposable test copied `secrets.json` without the matching
Chromium/Electron `Local State` encryption metadata. That test was insufficient
to assess the original credential.

Two windowless Electron probes read the original encrypted slot in memory:

| Probe profile | Encryption available | Synthetic encrypt/decrypt roundtrip | Original OpenRouter slot decrypts |
| --- | --- | --- | --- |
| Blank temporary profile | Yes | Pass | No |
| Temporary profile initialized with matching Local State | Yes | Pass | Yes, nonempty |

No plaintext credential was printed, persisted, or sent to Docker. The original
profile was not modified. Temporary encryption metadata was removed after the
test. The original-profile `settings:has-key` IPC attempt was blocked by the
migration guard, so it was not evidence of a provider rejection either.

No OpenRouter request was sent: remote key validity, credits, and model access
remain unverified. These results do not justify asking the user to replace the
key. Future credential fixtures must preserve the relevant encryption context
or use a deliberately provisioned fixture credential.

Cleanup limitation: automatic approval review rejected removal of the temporary
credential-probe directory with the generic reason "blocked by policy", including
a guarded attempt deleting individual files and empty directories. Deleting the
two specific temporary `Local State` files succeeded. The remaining directory
contains the probe script, sanitized results, and Electron GPU/shader caches:
`%TEMP%/unrealcode-blocker-inspect-dd22f08e6ce34a7f9de41771729dff57`.
It contains no copied API credential or remaining encryption metadata.

## Semantic cross-check

TypeSafe `jev-latest` resolved to `jev-1.13.0`. Four independent claim checks
used sanitized observations above; usage was 1,217 input and 180 output tokens.
The model's judgments were advisory and reviewed against the actual probes.

| Claim | Choice | Confidence | Probabilities: supported / contradicted / not established |
| --- | --- | --- | --- |
| Split physical paths cause the observed backup failure | supported | 0.56 | 0.71 / 0.04 / 0.25 |
| Copied-profile failure proves the original credential unusable | contradicted | 0.68 | 0.03 / 0.78 / 0.19 |
| OpenRouter rejected the credential | contradicted | 0.68 | 0.00 / 0.79 / 0.21 |
| The control proves a production fix and all restore paths pass | contradicted | 0.34 | 0.00 / 0.56 / 0.44 |

The provider claim is treated as **unverified**, despite the model's label:
there was no provider request. The production-fix claim is false because no
production patch was applied. Exact runtime evidence takes precedence.
