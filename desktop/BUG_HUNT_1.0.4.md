# UnrealCode 1.0.4 second bug hunt

Run on 2026-10-01 in the local `codex/timeline-density` candidate. Existing
implementation changes and the unrelated demo were preserved. No commit,
merge, push, tag or published asset changed.

## Confirmed and fixed

| Finding | Reproduction | Repair |
| --- | --- | --- |
| Malformed observer output disabled the rest of a task | An invalid JSON response followed by new evidence made only one model call instead of two | Block only the failed snapshot; accept new evidence or changed plan progress. Withdrawn responses cannot poison a refreshed request |
| Plan progress was ignored at an unchanged event sequence | Same approved revision advanced from Inspect to Verify, but made zero observer calls | Persist a progress fingerprint. Matching snapshots deduplicate; changed progress refreshes without rewriting approved content |
| Slow work reads never settled | Every 2.5-second response was superseded by a two-second poll | One read per selection, coalesce the latest range, preserve valid replies and reject old owners. Optimistic UI choices survive the initial preference read |
| Disconnect masked a recorded provider failure | Failure before an idle event became Interrupted in an offline view | Preserve terminal state and the failure event; live controls remain unavailable offline |
| Settled failure time inflated elapsed work | An idle event at 1,000 ms produced 1,000 ms instead of 10 ms; with an independent tool it should be 20 ms | Count remaining execution, stop counting settled failure time, and rebuild old derived durations |
| Optional cache repair prevented valid timeline reads | A failed SQLite write rejected a view that already had valid metadata and evidence | Repair best-effort, show a cache warning, keep saved stages and factual evidence readable |
| Empty approved plans hid saved inferred stages | An approved narrative plan with zero milestones replaced a saved Inspect stage with the factual fallback | Use the approved rail only when explicit milestones exist; retain the execution revision and inferred labels |
| Plan text bypassed observer redaction | A synthetic token in the objective, milestone and prior stage reached the mock model packet | Redact all model-bound text before truncation; keep approved local content unchanged |

All eight have a reproduction. Seven have failing-before unit regressions; the
slow-read case has a failing-before packaged UI fixture. Extra tests cover
unchanged progress, withdrawn malformed results, remaining parallel tools and
version-six cache repair. A timing follow-up caught pending host-service waits;
the final guard counts those waits until the tool settles while excluding
complete human waits. The redaction regression uses a synthetic, unusable token and a mock model.
No actual credential exposure or authority bypass was observed.

## Storage and compatibility

The rebuildable cache advances to version 7. A version-six profile gets a
verified `.before-1.0.4-v6.sqlite` backup before its activity projection rebuild.
Earlier pre-1.0.4 backup paths remain supported and preserved. Canonical events,
logical IDs, titles, question records, Fieldnotes and manual choices are retained.
The one-writer/two-reader architecture remains unchanged. The observer's new
progress fingerprint is optional in old metadata; migration does not schedule
historical inference.

## Verification and coverage

Final TypeScript checks pass. The desktop suite has **571 passes, six opt-in
skips and no failures** across 98 suites. Eight packaged workflows passed after
the first six fixes; timeline/appearance, navigation ownership, retry and
work/questions passed again after all eight. The rebuilt package matches its
main bundle and worker sources. The credential/license audit scanned 1,474
source/payload files and found no hits.

The rebuilt installer identity and remaining gates are in
[acceptance](ACCEPTANCE_1.0.4.md). Local machine-readable evidence is retained in:

- `.cache/bughunt104-before.json`
- `.cache/bughunt104-disconnect-before.json`
- `.cache/bughunt104-timing-before.json`
- `.cache/bughunt104-read-repair-before.json`
- `.cache/bughunt104-empty-plan-before.json`
- `.cache/bughunt104-plan-redaction-before.json`
- `.cache/bughunt104-last-fixes-after.json`
- `.cache/bughunt104-ui-before.log`
- `.cache/bughunt104-focused-after.json`
- `.cache/bughunt104-full-final.json`
- `.cache/bughunt104-packaged.json`
- `.cache/bughunt104-packaged-final.json`
- `.cache/bughunt104-payload-audit-final.log`
- `.cache/bughunt104-migration.json`

Rendered checks use the existing offscreen Electron/Playwright harness because
the Browser plugin is not available. They use disposable profiles, synthetic
providers and explicit fault injection. No native input or capture was performed.

The pass concentrated on new timeline/history/memory behavior and asynchronous
UI ownership, then ran the full application regression suite. Existing provider,
question, approval, queue, team, repository, MCP, document/browser, Computer,
recovery, credential and update checks remain part of that suite. Passing it
is not proof of every OS or account-dependent path.

A suspected retry-state leak was inspected separately: changing sessions remounts
the recovery view, and the backend rejects concurrent seeded resumption. The
rendered fixture checks conversation ownership and distinct retry IDs. No fix
is claimed for that unconfirmed lead.

Jev prioritized bounded source candidates; its uncertain judgments were followed
by deterministic reproductions, not treated as proof. Raw results are in
`.cache/bughunt104-triage-result.json`,
`.cache/bughunt104-verification-result.json` and
`.cache/bughunt104-last-semantic-result.json`.

Real native Computer, populated live Hindsight/model recovery, fresh-machine
installation, real model token overhead and screen-reader acceptance remain
separate gates. The earlier 10,000-note combined benchmark was not repeated. The copied
100,000-event version-six cache upgraded in 3,136.8 ms with a verified backup,
one writer and two readers; main Node event-loop p99 was 18.99 ms. The fixture
uses a consistent SQLite snapshot, including WAL data. An initial raw-file copy
missed 1,500 WAL records and was rejected before the upgrade check ran.
The published 1.0.3 installer and tags remain unchanged.
