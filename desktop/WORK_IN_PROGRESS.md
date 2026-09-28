# Active roadmap work

## 1.0.1 published — 2026-09-29

Implementation and local verification are recorded in [ACCEPTANCE_1.0.1.md](ACCEPTANCE_1.0.1.md); changes are described in [RELEASE_NOTES_1.0.1.md](RELEASE_NOTES_1.0.1.md). The authorized unsigned release is now published, with downloaded-asset checks recorded in [RELEASE_VERIFICATION_1.0.1.md](RELEASE_VERIFICATION_1.0.1.md). It offers release notifications and manual installation. Future versions require separate authorization. The sections below are historical; their local hashes and publication holds do not describe the current release.


## 1.0 unsigned provenance release — 2026-09-28

The owner replaced the certificate requirement with a public SHA-256 manifest,
Git tag, GitHub Artifact Attestation, and public build scripts. The release
workflow now builds and audits from the exact tag and will publish only after
checksum and attestation verification. It has not yet run on the final tag;
the installer remains explicitly unsigned and in-app updates stay disabled.
The previous source acceptance run `36455245383` passed Windows and backend
jobs at `8ab295d`. The unrelated untracked demo under `docs/` is preserved.
Local unsigned preflight package: `dist-release-preflight/UnrealCode-Setup-1.0.0.exe`,
SHA-256 `424902428A662D4FB143111E38A354D7565EB4937250E6FB983724A3C671DBD0`.
Both installer and unpacked app report Authenticode `NotSigned`. TypeScript and
389 desktop tests passed (3 optional skips); the checksum tamper tests and
packaged no-Docker/credential smoke passed. The payload audit scanned 1,114
files, reviewed 207 production packages, compared seven local credential
values privately, and found zero matches. The reachable-history scan found
zero matches in 1,593 blobs. This local hash will differ from the hosted build;
only the tagged hosted artifact is eligible for publication.
The nonpublishing hosted release preflight `36460317190` passed checksum
generation, unsigned-state inspection, GitHub attestation creation and
verification, package audit, and packaged smoke. Initial broad `main` CI then
exposed Go bridge fixtures that assumed `/workspace` existed on bare Linux and
macOS runners. The fixture now uses a temporary workspace; its race test passed
in a plain Go Docker image without `/workspace`. The next broad CI run passed
Linux but exposed a macOS project-search issue: `/var` and `/private/var`
referred to the same temporary root, while search compared their path strings.
Search now canonicalizes its root, and a symlink-root regression passes in the
plain Go image. Broad CI and the nonpublishing release preflight must rerun on
this corrected source before tagging. Versioned release notes are required for
future tags; the release page will display the exact installer SHA-256 as well
as attaching `SHA256SUMS`.
The corrected macOS job passed. Ubuntu then intermittently timed out waiting
for a required-question/provider-failure test; the failed job passed on rerun.
Inspection found an answer-before-operation-registration race that could leave
an answered required question awaiting forever. The bridge now reconciles the
durable question state after registration. A deterministic regression for that
ordering and the provider-failure retry test passed 20 race-enabled repetitions
each in a plain Go image. Final hosted CI must pass on this patch.

## 1.0 release-readiness checkpoint — 2026-09-28

The audited preview source was pushed to the public `codex/desktop-roadmap`
branch at `99ffb04` after the owner explicitly authorized a 1.0 push. Hosted
Desktop acceptance run `36453526173` passed its bridge job and the Windows
helper, clean dependency install, TypeScript, desktop tests, packaging, and
release audit. Its smoke step failed because a Docker CLI with an unavailable
daemon correctly returned `DOCKER_UNAVAILABLE` instead of the local fixture's
`DOCKER_MISSING`. The smoke assertion now accepts either precise failure code
with its own required recovery action and Retry; local smoke and 31 focused
failure-classification tests pass. The next hosted run (`36454513515`) passed
bridge, Windows tests, packaging, and audit, then identified a third legitimate
Docker state on its smoke host: `DOCKER_WINDOWS_ENGINE`. The smoke assertion now
accepts that state only with its specific setup-help and Retry actions. A new
hosted run is pending. SignPath Foundation's published modified-upstream rules
are currently unmet; only an explicit exception could make its free NSIS signing
route available. The proposed policy and application evidence record this openly.
No trusted 1.0 signature, stable tag, or release asset exists.

The current local, unsigned candidate is
`dist/release-readiness-1fd1a0b/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256: `2FA55CE240A0876C3195C55F75EECC8950B69D5994A5719C7AE6F8E8DD993550`.
Product source is frozen in local commit `1fd1a0b`. The untracked
`docs/orbit-garden-demo.html` is an unrelated demo and was preserved outside
that commit. The new package's `app.asar` hash exactly matches the prior
acceptance package. The new installer also passed its own composer/activity,
recovery, signature-state and payload-audit checks.
This is a local preview checkpoint, not a stable 1.0 acceptance or publication.
The owner explicitly authorized signing and pushing 1.0 on 2026-09-28. Because
no trusted signer is configured, the audited preview source branch may be
pushed for hosted CI; the stable tag and release assets remain pending a
verified signed installer.

The full desktop suite initially exposed a 5-second timeout in a browser
WebSocket fixture under suite load. That test passed alone in 3.4 seconds; its
explicit browser-test deadline is now 15 seconds. A second full run exposed
an `ENOTEMPTY` cleanup race: a debounced background-job metadata save could
outlive workspace closure. Background-job saves now serialize, closure waits
for an in-flight save, and closing prevents another debounce. A regression
holds a save open while closure waits. Fixture teardown closes its job service
before removing its disposable directory. The final desktop run passed
**389 tests**, with **3 optional skips** across **62 files**. TypeScript passed.

The full Go race suite and vet passed in the pinned Go 1.27.1 Linux image.
The test container required `/workspace`, as the real backend Dockerfile
provides; omitting it caused an initial fixture-only failure. Three Python
worker tests passed. The actual Windows package passed offscreen Docker/Electron
checks for coding and editor integration, recovery, Tool Activity and questions,
composer controls, accessibility, branding, workflows, MCP connections,
specialist teams, verification, diagnostics, parity commands/goals/jobs/hooks,
offline history and the missing Linux pipe, Memory Settings, and preservation
of a memory volume with a missing manifest. The Tool Activity top and toolbar
bottom both measured 89 CSS pixels; the narrow overlay stayed within the
viewport at 150% and 200% scaling. These checks do not establish the visible
window's placement or behavior on virtual desktop 2.

The general smoke fixture now selects the Recovery settings tab before checking
its heading, accepts the current structured `DOCKER_MISSING` guidance, tests
the selected packaged executable, and writes screenshots only to its isolated
temporary profile. Its missing-Docker and encrypted-key checks passed. A live
Codex subscription check used a disposable file and completed native ReadFile.
A live Hindsight check on the matching runtime package verified model setup, retention,
recall, reflection, a private database backup, restore into a new volume,
forgetting, and explicit re-verification. Synthetic memory usage was 10 model
requests, 21,396 input tokens and 925 output tokens.

The exact payload/source audit scanned **1,106 entries** and reviewed **207
production npm packages**, comparing seven local credential values privately
with zero matches. Reachable Git history scanned 1,257 blobs with zero secret
hits. The patch whitespace check passed. No 1.0 tag, release asset upload, or
visibility change was made in this sweep. This agent did not install
the candidate on another machine. The user subsequently reported that an
installer named `UnrealCode-Setup-1.0.0-preview.1.exe` installed successfully
on a second machine. The user supplied SHA-256
`2FA55CE240A0876C3195C55F75EECC8950B69D5994A5719C7AE6F8E8DD993550`,
which matches this committed candidate exactly. This is user-reported installer
acceptance, not an agent-observed launch, Docker, workflow, or upgrade check.
The local CI-equivalent Docker build and bridge capability check passed; its
temporary image tag was removed afterward. No valid code-signing certificate
was found in the current-user or machine certificate stores, and no publisher
signing configuration is present. Windows Sandbox and Hyper-V management are
not available here; the exact candidate's second-machine installation is
user-verified, while post-install behavior still requires evidence.
The clean `npm ci` install, TypeScript check, and full desktop suite passed again
after the source commit. The real-Docker recovery integration passed both its
volume-transfer and retained-volume tests. The exact committed package passed
its credential-context test; the reachable Git-history scan covers over 1,500
blobs with zero secret matches.

GitHub currently reports `MCShotty/UnrealCode` as public. Historical Desktop
acceptance run `36269843333` actually started: its bridge job passed and the
Windows job failed at the old missing-Docker smoke assertion. The later 1.0
source push and hosted run are recorded above. The owner authorized that
public source push for CI; the stable signed release remains pending.
An attempt to remove the superseded local `dist/release-readiness-20260928`
test package was rejected by automatic approval review with the sole reason
`blocked by policy`. It remains intact; no alternate deletion method was used.

Still open for stable 1.0: publisher signing and a signed-update exercise;
fresh-machine end-to-end verification and upgrades from supported 0.x profiles; hosted
CI on the frozen candidate; native desktop and assistive-technology checks;
live Claude/OpenAI API verification where valid credentials exist; and a
reviewed signed release artifact. The recent user-reported overflow must
also be confirmed against this new executable in the visible app rather than
the identical screenshot of an older build.

## Cleaner controls and expressive progress — 2026-09-28

The latest local candidate is `dist/controls-expressive/UnrealCode-Setup-1.0.0-preview.1.exe`.
SHA-256: `6FD098C846A2456D3C76AD7EDC19AD2305582FB0A8E3EFB2272A8C6921CEA88D`.
It remains unsigned and unpublished. The backend and storage protocol are unchanged.

The later menu refinement caps the desktop Task options popover at 420 × 500 CSS
pixels, with independently scrolling fields and a visible footer. Its compact
state measured about 414 × 427 CSS pixels; the expanded body scrolled while the
footer stayed inside the panel. A mid-width 850-pixel window had no clipping.
The compact Tool Activity overlay is now capped at 520 × 620 CSS pixels and
keeps its own vertical scroll. Packaged checks repeated both workflows on the
exact installer: `%TEMP%/unrealcode-controls-yfhwFe` and
`%TEMP%/unrealcode-work-activity-UwlooL`, zero renderer errors, including
150%/200% scaling. Existing older app processes still point to previous build
folders; opening the candidate executable is necessary to see this UI.

- The composer now has one Send/Stop control, separate pending labels, reactive
  image-only drafts, composition-safe Enter handling, double-activation protection,
  and conversation-scoped request locks. Ctrl+Shift+. stops the selected task
  while preserving its draft; Task options also provides Stop task.
- Task options is an anchored dialog/popover with a compact bottom sheet,
  Off/Manual/Automatic selection, grouped capacity fields, optional Unlimited
  budgets, explicit Apply/Cancel, inherited child settings, and save-error handling.
- Tool Activity occupies the workspace below the real toolbar. Available content
  width determines side-pane versus modal presentation. Its React subtree survives
  layout changes; filters, selected detail and scroll position are retained.
- Shared progress shapes use CSS animation, visibility/intersection checks and
  reactive reduced motion. Running work, busy actions and backend preparation
  display progress; human waits remain distinct. Completion animates only on a
  newly observed successful transition. Streaming text and metrics stay stationary.

TypeScript and 31 focused desktop tests pass. The exact package passed two
offscreen Windows/Docker fixture workflows with no renderer errors:
`%TEMP%/unrealcode-controls-UfUn3t` and `%TEMP%/unrealcode-work-activity-u2vchR`.
They exercised live steering with parallel tools, failed sends/settings saves,
image drafts, double activation, A → B → A pending requests, Stop with a draft,
question/retry recovery, search anchors, panel state across resizing, focus,
dark/light/system settings, 150%/200% scaling and live reduced-motion changes.
Document visibility was simulated in the isolated renderer to verify animation
pause/resume. Native virtual-desktop placement and assistive-technology behavior
were not verified by these fixtures.

Measured panel top and toolbar bottom both equalled 89 CSS pixels, retaining
650.25 pixels for chat. Steering UI acknowledgement was 526 ms, including a
deliberate 350 ms fixture transport delay; this is not a provider-speed benchmark.
The final audit scanned 1,106 source/payload entries, reviewed 207 production
packages and privately compared seven credential values, with zero matches.
No runtime dependencies were added.

Repeat the UI checks from `desktop/` with `node scripts/qa-composer-controls.mjs`
and `node scripts/qa-work-activity.mjs`; set `UNREALCODE_QA_EXECUTABLE` to test the
packaged executable. Both use disposable profiles and a synthetic provider.
One package directory was produced for this change. Automatic approval review
blocked deleting the prior inactive `dist/work-activity-final` package, giving
only "blocked by policy"; that approximately 735 MB copy remains on disk.
Prior verification records
below remain historical; the 1.0 push/publication hold remains active.

## Collapsible work, question cards, and Tool Activity — 2026-09-28

Local implementation adds request-level work disclosures, required/background
question cards with explicit submission and saved drafts, and a searchable,
paged Tool Activity side panel (modal overlay in compact windows). Ordinary
chat remains steering. Stable question receipts, explicit restart resumption,
`WaitForInput`, and deliberate response retry are backed by the Go bridge.
Provider failure envelopes now fail the turn, including historical replay.

The existing SQLite writer and two readers project work groups, question states,
tool identities, output pages, and counts. Schema 3 rebuilds those derived records;
session IDs, titles, canonical logs, and user settings are retained. Recovery
includes `desktop-questions`; conversation drafts live in registered app data.
The new bridge capability is `questions.v2`.

Focused Go race tests cover idempotent answers, ownership/revision rejection,
receipt replay, provider failure followed by explicit retry, and background
answers that do not interrupt active inference. Worker tests cover parallel
timing, human waits, historical failures, large output, and restart activity.
TypeScript and the desktop regression suite pass. Packaged Windows/Docker
fixtures verified required/background questions, drafts across navigation,
accepted answers across an empty response, retry without replaying the question,
tool detail viewing, historical cancellation controls, dark/light themes,
compact overlays, and reduced motion. The two-project queue/handoff/context/
search workflow also passed; notification routing there uses an explicit mock.

The 100,000-event fixture measured 15.47 s indexing, 2.23 ms median warm history
pages, 1.22 ms median warm search, and 19.66 ms event-loop p95. These synthetic
measurements include test overhead and concurrent local checks; they do not
establish provider token savings. Native desktop placement, live OpenRouter service recovery,
signing, and fresh-machine installation are not established by offscreen fixtures.

### Verified local candidate

- Installer: `dist/work-activity-final/UnrealCode-Setup-1.0.0-preview.1.exe`.
  SHA-256: `2B739B4AC2601441A69F47646AE261E6897FE811D344FDC7F6C40342B27E445E`.
  Authenticode is `NotSigned`; no installation over the user's app was performed.
- Backend: `unrealcode:1.0.0-preview.1-256133e63f53`; negotiated capability
  checks passed, including `questions.v2`.
- Full Go race tests and vet passed for `cmd`, `harness`, and `internal`.
  TypeScript passed; desktop suite: **376 passed, 3 optional skips**. A final
  focused cache/activity/queue/runtime/chat run passed all 53 tests.
- `scripts/qa-work-activity.mjs` passed against this exact package with real
  Docker and a synthetic provider: multiple required questions, keyboard choice
  selection, free text, saved drafts, independent tool completion during a human
  wait, retained answers after an empty response, deliberate retry without
  duplicate question/tool execution, background questions/dismissal, search
  anchors into collapsed work, tool details, and cancellation visibility.
  Dark/light, Follow Windows selection, 150%/200% compact bounds, reduced motion,
  and focus restoration passed with zero renderer errors. Zoom assertions wait
  for Chromium's media/layout transition before measuring. Evidence:
  `%TEMP%/unrealcode-work-activity-3pSYjh/report.json` and adjacent screenshots.
- `scripts/qa-workflow.mjs --packaged` passed queue, two concurrent projects,
  handoff, context, search, required input, and mocked notification routing:
  `%TEMP%/unrealcode-workflow-5u32ib`, nine fixture requests, zero renderer errors.
- Final payload audit: **1,097 source/payload files**, **207 production packages**,
  seven locally available credential values compared privately, **zero matches**.
  No new runtime dependency was added for these features.
- Twelve synthetic runs per build compared baseline `825b263135ff` to the
  candidate above, with concurrent 100,000-event writer/two-reader indexing on
  the candidate. Median task time: 356.97 / 352.07 ms; steering acknowledgement:
  2.34 / 2.31 ms; parallel tool overlap: 275 / 274 ms. These observations do not
  establish a speed improvement or token savings. Cache fixture:
  `%TEMP%/unrealcode-overlap-cache-nN4Q5P`.

Provider failure tests also cover a real in-progress shell tool: failure drains
its cancellation state into canonical records; retry does not replay that tool
or partial tool calls from the failed model response. Answer/retry can explicitly
continue its existing queued task while leaving the project queue paused;
later queued tasks still require Resume. Reader queries use one SQLite snapshot
for work, question, badge, and row data. Search waits for projection and saved
expansion preferences before revealing its target.

All changes remain local. The 1.0 push/publication hold remains active.

> Current local coding-workflow implementation and verification: [PARITY_IMPLEMENTATION.md](PARITY_IMPLEMENTATION.md). Earlier counts, hashes and release notes below are historical snapshots, not the current candidate.

**Earlier independent-review candidate, 2026-09-28:** The eight independent-review findings are fixed: host project/recovery I/O uses an opened-directory native helper; browser WebSockets obey origin grants and cancelled actions stop; replacing a Memory profile clears prior project consent; reflection uses a fresh bank of scoped, non-forgotten source records; rejected specialist settings do not publish permissions; reindexing preserves inactive/offline history; and late goal usage is matched to its permitted request after pause. Forgotten records also reject correction, and two-store team configuration restores backend flags if the host commit fails.

Verification at that stage: TypeScript, 366 desktop tests (3 opt-in tests skipped in the default run), Go race/vet checks, Windows-native helper tests, two real-Docker recovery integrations, and source coding/recovery/planning-goal workflows passed. Live Hindsight verified retain/recall, scoped reflection, temporary-bank deletion, forgetting, and disable with synthetic data. The exact rebuilt Windows package passed coding/editor/integration/archive, recovery, parallel specialist/cancellation/usage/restart, and Memory Settings dark/light/compact/200%/keyboard/accessibility checks. Its payload audit scanned 1,083 artifacts, reviewed 207 production packages, compared seven local credential values privately, and found zero hits. `mime-types` is now a pinned direct MIT dependency for confined buffer uploads; regenerated notices reflect npm's deduplicated production tree.

Unsigned local QA installer SHA-256: `6624ADB45CA5474E4E44F8F6352767C2C40C1A480F81C36FEB3D1192AD6B2B51`. Backend: `unrealcode:1.0.0-preview.1-825b263135ff`, including the new `goal.usage.v1` capability. The bundled native helper matches the locally tested executable. This build was tested offscreen and was not installed over the user's app. Hard-linked files and ReFS locations are explicitly unsupported by confined host I/O. Legacy unverified restore-volume cleanup, long-term metadata growth, wider container/state isolation, fresh-machine/signing gates, and completion of the full codebase audit remain open. Nothing was committed, pushed or published.

Earlier source and latest packaged bug-hunt candidate: `dist-bug-hunt-20260928r/UnrealCode-Setup-1.0.0-preview.1.exe`, SHA-256 `F14704DC57C25F62D86E72620EB4B793042BA6B6284CACF97BCE256D9EEEBEBE`. It is unsigned and unpublished. Packaged evidence: Memory Settings, real-Docker recovery, and a fault-injection check that preserves an existing Memory volume when its manifest is missing. **Source became newer than this package:** post-save notification resilience, journaled restore-volume identities, settings validation, bounded credential input, filtering unknown settings fields from renderer responses and normal backup exports, rejecting provider URLs with embedded credentials, truthful background-job timeout/ownership outcomes, turn-scoped Memory retention, browser grant/diagnostic fixes, MCP/host-operation durability checks, revision-bound MCP tool selection, consistent absolute Docker CLI resolution, OAuth callback/authorization hardening, connection-vault failure handling, queue persistence rollback, durable queued-session attempt IDs, a single-writer Linux lease for backend session storage, and a simpler direct provider/model flow in the Memory Settings tab. That earlier source passed 339 desktop tests (2 skipped), TypeScript, `build:code`, and the full Go bridge suite in Docker. Offscreen checks passed Memory Settings in dark/light/compact/200% scaling with keyboard tabs, a real-Docker queued isolated worktree/tool workflow after the bridge lease was added, a real-Docker two-project queued workflow with handoff, context, search, notifications and required input, plus earlier coding, browser, MCP, Hindsight, backup, and recovery checks. A two-container volume-lock fixture rejected the second backend while the first stayed running. A real-Docker volume transfer integration test passed. Requested-volume collision and failed-import cleanup passed against real Docker; unregistered-volume, invalid-settings recovery, synthetic credential-context behavior, settings projection, and Settings navigation passed in other offscreen checks. An earlier source-plus-older-package audit scanned 1,063 artifacts, reviewed 213 production packages, privately compared seven local credential values, and found zero hits. The newest source changes have not been packaged or audited as an installer. Live Hindsight database backup/restore passed on the package preceding `r`; specialist-team and Memory paging checks are older historical passes. Details and open defects: [DEEP_BUG_HUNT_2026-09-27.md](DEEP_BUG_HUNT_2026-09-27.md). This paragraph does not declare 1.0 ready.

Canonical checkout: I:\UnrealCode, branch codex/desktop-roadmap. I:\UnrealGUI is the backup.

## Current user constraint

**Do not push 1.0 to GitHub yet.** Keep source, commits and installers local.
No 1.0 release or repository visibility change without a new user instruction.
Use virtual desktop 2 for visible windows. All current app tests run offscreen
with isolated profiles; native window placement remains unverified. Delegation requires
an explicit user request or a required skill review step.

## Current bug-hunt and branding changes (local, uncommitted)

- Fixed evaluation cleanup targeting pre-restore storage, and legacy retained evaluation volumes being omitted from backups. Restore remaps their report identities.
- Fixed file/directory replacements in dirty snapshots, integration, archive restore, and selective rollback, including nested folders and Windows short-path aliases. Unexpected nonempty folders are preserved.
- Fixed session links and metadata being overwritten by stale integration/archive saves. Metadata patches now merge under the existing mutation queue.
- Fixed the welcome screen retaining a dark gradient in Light mode.
- Replaced the triangular mark with the supplied UC monogram, redrawn as flat SVGs for both themes, PNGs, and a seven-size Windows ICO. Added reproducible asset generation and packaged branding QA.
- Rewrote the root README around product features, providers, architecture, third-party code and release limits. Preserved the harness guide in docs/UNREAL_AGENT_ARCHITECTURE.md; added root AGENTS.md.
- Six new regression tests; 105 desktop tests pass. The MCP notification test now waits for its actual state change instead of sleeping 100 ms. Full Go race/vet, three Python tests, TypeScript and secret-scanner regression passed.

Final local installer SHA-256: 47001949E60DB01E55D2D2E6AB4998A710669E5371FB4F08358B171035C32C56. Packaged coding, recovery, branding, and accessibility checks passed on this installer. Branding passed Dark, Light, and Follow Windows (both system schemes), with reduced motion. Accessibility checks reported zero WCAG A/AA violations on setup and Settings, including the light welcome screen, Settings at 150% scaling, keyboard close and focus restoration. Native desktop placement, full assistive-technology coverage and fresh-machine installation remain unverified.

Final payload audit: 918 files/artifacts, 212 production npm packages, seven local credential values compared privately, zero matches. The installer remains unsigned. No commit, push, release upload or repository visibility change was performed.

Final offscreen fixture directories under Temp: unrealcode-branding-i7Cxef, unrealcode-accessibility-OqMxVh, unrealcode-coding-j8jBVZ and unrealcode-recovery-RLuKcM. The backend source is unchanged by this patch; its existing fingerprint remains unrealcode:1.0.0-preview.1-f79c10fee166.

## Published before the hold

0.9.0: db4b776, tag/release v0.9.0. Its remote installer digest was verified:
E0772E933C14A6F1465F3345C278769E6A7C5231220E38A5D371ECA1A5CDF1D4.
Live GitHub inventory contains 0.3.0, 0.8.0 and 0.9.0. Earlier local tags and
installers exist; do not assume their release entries remain online.

## Earlier local preview (superseded by the bug-hunt build above)

Version 1.0.0-preview.1. Installer:
desktop/dist/UnrealCode-Setup-1.0.0-preview.1.exe
SHA-256: 1E00847D1A081DAD962F0FAE21690FE8CC7DD95B5B67866B13B90F6631C17042.
Features and acceptance details: RELEASE_1.0_PREVIEW.md and ROADMAP_STATUS.md.

Implemented recovery export/import, original metadata backups, transaction rollback,
fresh session-volume restore, authority resets, damaged-profile recovery, explicit
signed-update controls, storage previews/cleanup, integrated-worktree archival and
restore, support previews, setup guidance, latest chat history, bounded team output,
keyboard focus, canonical editor workspace identity and selection guards.

99 desktop tests, TypeScript, full Go race/vet, focused final bridge race, three
Python tests and the scanner regression passed. Packaged recovery/long-history,
coding/archive/editor, accessibility, no-Docker/encrypted-key, team, verification,
connections, workflow and diagnostics fixtures passed. Final rebuild repeated
recovery and coding; latest fixture directories in Temp are unrealcode-recovery-Vf0NyI
and unrealcode-coding-oRJHjP. Final backend: unrealcode:1.0.0-preview.1-f79c10fee166.
Requires history.latest.v1 capability. Backend fingerprint now covers license inputs.

Credential/payload audit: 905 files/artifacts, 212 reviewed production packages,
seven local credential values compared privately, zero hits; dev-only packages
excluded from application. Reachable Git blobs before the local commit: 1197,
zero hits. Retained release installers matched remote digests and their extracted
payloads passed. All audit calls to GitHub were read-only after the hold.

## Limits and remaining acceptance

Stable 1.0 is not signed off. No signing credential is configured. Unsigned builds
keep updates unavailable. Fresh-machine install/upgrade, a real signed update,
full assistive-technology coverage, and native window/chrome checks remain unverified.
Hosted Actions did not start because of account billing/spending limits (36262688853).
The prior signing-method question remains unanswered. Do not ask for a new API key.
Provider login/refresh remains external; latest live Codex evidence is from 0.9.
Recovery import currently requires the original app-data/profile and project paths.

## Build notes

Desktop scripts run from I:\UnrealCode\desktop. Packaging uses system CAs.
build-release.mjs invokes npm dependency discovery through Node because this host's
PowerShell EncodedCommand wrapper can return an empty stream. It retains the real
production/transitive dependency tree. Use npm run build:win; stable signing uses
npm run build:stable with real credentials and UNREALCODE_PUBLISHER.
Model weights, Docker Desktop, external CLIs and test tooling are not bundled.
Dependency notice provenance is documented in third-party-licenses/README.md.

## 2026-09-27 - Threaded history and recovery

Electron SQLite cache (one writer and two query workers), timestamp location
registry/migration, structured failures, offline history and themed scrolling are
implemented locally. See THREADED_HISTORY.md and THREADED_HISTORY_VERIFICATION.md
for interfaces, tests, evidence and the unsigned installer checksum. 137 desktop
tests passed; packaged offline, Docker recovery, coding and accessibility checks
passed. The real profile has not been migrated during fixture testing. Migration
runs after its backup on the updated app's next launch. No push or publication.

## 2026-09-27 - Deep bug hunt

Eleven confirmed issues fixed in local source: migrated child storage reachability,
ambiguous relocation recovery, evaluation volume restoration, query cancellation
scope, checkpoint filename indexing, resource-failure classification, stale
renderer selections, draft preservation, editor recovery naming, fresh session
metadata after forks/handoffs, and Windows metadata sharing retries.

152 desktop tests, TypeScript, full Go race suite under Docker --init, Go vet,
three Python worker tests and seven packaged acceptance workflows passed. Final
credential/redistribution audit: 940 artifacts, 212 production packages, zero hits.
See DEEP_BUG_HUNT_2026-09-27.md for reproductions, limits, evidence and installer
checksum. App data remained in disposable test profiles. No commit or publication.
