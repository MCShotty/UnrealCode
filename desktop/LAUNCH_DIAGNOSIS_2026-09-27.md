# Packaged launch diagnosis — 2026-09-27

## Finding

Avast AutoSandbox intercepts the packaged UnrealCode executable at the observed
failed launches. The retained processes have zero CPU time, no window, no
enumerated modules, and one suspended thread. This places the stall before
Electron and UnrealCode initialize.

Candidate: `desktop/dist-recovery-fix/win-unpacked/UnrealCode.exe`

SHA-256:
`1D94B198C2B0E856BE022CBF37B35223A4095BA6A132EB6A7E869B9D541F3E6C`

## Direct evidence

`C:\ProgramData\Avast Software\Avast\log\autosandbox.log` records the exact
candidate path with `Result: Sandboxing` and
`Instrumentation: Instrumentation inside sandbox requested` at each launch:

| Local time (UTC+03:00) | Candidate record line | Process evidence |
| --- | --- | --- |
| 11:24:27 | 950511 | Earlier packaged launch |
| 12:14:39 | 950518 | PID 20500 created 12:14:38.990; thread 7196 suspended |
| 12:36:42 | 950525 | PID 41068 created 12:36:41.638; thread 42344 suspended |
| 15:43:52 | 950532 | PID 33028 created 15:43:51.964; stopped during the previous test |

The matching `AvastSvc.log` records say the file was successfully marked for
virtualization at 09:14:40 UTC (line 3293), 09:36:43 UTC (line 3323), and
12:43:53 UTC (line 3522). These timestamps match the local launch times above.
Log line numbers are a snapshot and may change after rotation.

The temporary NSIS helper was also sandboxed at 11:18:43 local time. This explains
why that build step and direct packaged launches stalled in the same environment.
The older `desktop/dist/win-unpacked/UnrealCode.exe` path instead has an existing
Avast exception recorded at 10:39:28; that exception does not cover this candidate.
No exception was added by this diagnostic investigation.

## Boundaries

- The installed Electron 44.4.5 runtime previously started the current application
  and passed the documented recovery/profile checks. It and the packaged candidate
  are both unsigned and have no Zone.Identifier stream. Lack of signing alone
  does not distinguish the working and failing launches.
- No matching current-application malware verdict was returned by the scoped
  Avast ScanResult query. Sandboxing is not proof that the application is malware,
  and this investigation is not a malware clearance.
- The precise internal reason Avast fails to release or initialize the sandboxed
  process remains unknown. Its interception is directly recorded; no app stack
  trace exists because the retained processes have not reached initialization.
- The prior Docker recovery defect is separate and has its own verification
  report. Changes to Docker/provider initialization cannot repair this observed
  suspension before application code begins running.

## Next step

Review the exact candidate in Avast's protection/analysis interface and complete
its normal review process, or obtain a vendor resolution for the stalled analysis.
After Avast releases the candidate, repeat the direct packaged launch and workflow
smoke tests. Signing remains a prerequisite for stable distribution; signing alone
is not claimed to fix the current Avast behavior.

Avast documents that CyberCapture can lock unrecognized files while analyzing
them: https://support.avast.com/en-us/article/antivirus-cybercapture-faq
The local evidence above specifically names AutoSandbox; the documentation is
background, not a substitute for those records.

This investigation read process metadata, executable metadata, registry entries,
Windows events, and Avast logs/database. It did not change antivirus settings,
launch another app process, alter credentials, send app-model requests, or push
or publish anything. Application source is unchanged.

## Advisory semantic check

TypeSafe `jev-latest` resolved to `jev-1.13.0`. A focused follow-up over the
observations used 588 input and 56 output tokens. Noul results were explicit
Avast interception 0.78, established malware 0.04, and support for a Docker-code
fix 0.10. These are advisory claim checks; the timestamped records and process
state provide the diagnostic evidence. The raw response is retained privately
at `%TEMP%/unrealcode-launch-jev-20260927.json`.
