# Changelog

## 1.1.0 - 2026-10-02

### Added

- Versioned advisory inputs and negotiated `async_advisory_v1` capability.
- Verified canonical-prefix backups before the first advisory record.

### Changed

- Decision advice and memory recall run after message acceptance and arrive at
  an existing model boundary. Steering, Stop and independent tools stay usable.
- Bounded decision scheduling shares two app-wide leases across project backends.
- Accepted messages have durable receipts; pending advice restores as interrupted.
- Advice status and attributed memory references are visible in the work feed.

### Fixed

- Blocking Jev preflight and foreground Git evidence collection.
- Cancellation while a local decision worker waits for a lock or writes stdin.
- Valid image/prompt envelopes exceeding the bridge frame limit.
- Late events from an old backend affecting its replacement, and split UTF-8
  chunks corrupting Arabic text.
- Advice/control events causing unnecessary timeline analysis.
- Invalid decision probabilities, score legends and unsafe redirects.

### Known limitations

- The local installer is unsigned. Published 1.0.4 assets remain unchanged.
- Older binaries cannot read the new advisory input kind; rollback requires
  deliberate restoration of a verified earlier snapshot while preserving
  newer records separately.
- Native Computer, live memory/provider, fresh-machine and assistive-technology
  acceptance remain separate gates. See [1.1.0 notes](desktop/RELEASE_NOTES_1.1.0.md).

## 1.0.4 - 2026-10-01

### Added

- Live, evidence-linked stage timelines authored by the consented memory model.
  Cached views refresh every three seconds while visible. Meaningful activity
  can trigger analysis at a three-second minimum, sharing two inference slots
  with Fieldnotes and Hindsight. Idle polling does not make model requests.
- Compact spacing as the default, with the previous spacing retained as Cozy.
- Four small work entries, a faded earlier peek, and paged Show all navigation.

### Changed

- Approved executing plans retain their revision when a newer draft is edited.
- The timeline leads the Compact activity rail. Secondary context folds away.
  A single top-right container control provides status and recovery actions.
- New stage markers and connecting lines use the existing Expressive motion
  system. Historical and inferred completion cannot trigger a celebration.

### Fixed

- Busy conversations invalidating every observer response, truncated plan
  coverage, reset transient backoff, stale consent/provenance, and queued
  inference continuing after cancellation.
- Disclosure identity and focus changing with older history, premature closing,
  missing warning labels for short or unknown durations, and segmented feed
  pagination around steering messages.
- Docker dependency recovery blocking cached timelines, work and Tool Activity.
- Remote browser content covering app menus. Session titles now exclude internal
  advisory blocks and preserve Arabic characters when shortened.
- Legacy cache projections now rebuild from retained records after a verified
  backup. Interrupted backup files are preserved for inspection and replaced.

- Malformed timeline output blocking the remainder of a task, plan progress
  being skipped at an unchanged event sequence, and cache repair preventing
  otherwise valid timeline reads.
- Slow work-view replies being starved by overlapping polling. Recorded failures
  now keep their state after disconnect, and settled failure time no longer
  inflates work duration. Version-six cached durations are rebuilt with a backup.
- Empty approved plans hiding saved inferred stages. Timeline observer packets
  now redact plan and prior-stage text before sending it to the memory model.

### Known limitations

- The installer is unsigned and upgrades are manual. Earlier releases remain
  unchanged. Model-authored stages are interpretations, not verification.
- Continuous activity can use more memory-model requests than the old 20-second
  observer. Existing memory limits still apply; real-provider overhead needs a
  representative consented workload.
- Native Computer, live populated-memory recovery, fresh-machine installation,
  and assistive-technology acceptance remain separate gates. See the
  [acceptance report](desktop/ACCEPTANCE_1.0.4.md) for evidence and limitations.

## 1.0.3 — 2026-09-30

### Added

- App-wide user-authored **Fieldnotes**, with project/session attribution, local
  matching, editable originals, explicit inclusion/exclusion, durable revision
  receipts, optional memory interpretation, and withdrawal from future guidance.
- Default-off, bundled selected-window **Computer** controls: task/model-bound
  grants, physical takeover, explicit handback, emergency stop, a chat companion,
  transient screenshots, and a built-in computer-use skill.
- Packaged regressions for Fieldnotes, Computer startup, asynchronous navigation,
  and the reliability repairs in the Windows acceptance and release workflows.

### Changed

- **Abilities** brings Skills and MCPs into their own sections. Appearance offers
  **Cinder Dark**, **Ice Dark**, **Flashbang**, and **Follow Windows**.
- Workspace transitions and small Material 3 Expressive feedback share motion
  tokens, preserve reading positions, and honor reduced motion.
- Fieldnote, timeline, and memory inference share two bounded dispatch slots.
  Fieldnote originals remain useful offline and with memory disabled.

### Fixed

- Skill creation collisions; stale editor reloads, session refreshes and Fieldnote
  editing results; cross-project session display; MCP revocation and pagination.
- Canonical guidance receipts disappearing or changing during cache outages,
  partial projections, duplicate submissions, continuation, and cache rebuilds.
- Late guidance configurations reviving withdrawn revisions; obsolete timeline
  summaries publishing after newer evidence; memory attribution and turn races.
- Computer startup after disable, queued grants after Stop, task information
  leakage, stale model-destination reviews, and incomplete credential masks.
- Readiness rejection messages being replaced by a generic helper-exit error.
  Elevated processes, missing desktop monitoring, unavailable input monitoring,
  and incompatible protocols retain their actionable explanations.
- Browser uploads continuing after cancellation, takeover or origin revocation.
- Failed metadata writes skipping shutdown barriers, and failed goal saves leaving
  live scheduling inconsistent with durable state.
- Windows publisher verification uses the system shell and built-in security
  module, with unavailable verification distinguished from an invalid signature.
  Both remain fail-closed; unsigned installation stays manual.
- Model-facing titles and source labels escaping credential redaction; native
  observation-derived content entering automatic memory through incomplete scans.

### Known limitations

- The Windows installer remains unsigned. Downloads and installation are manual;
  checksums and GitHub attestations do not remove Windows publisher warnings.
- Computer is experimental and off by default. Packaged startup and authority
  checks do not establish actual native clicking/typing, capture masking, physical
  takeover, lock/unlock, desktop changes, or mixed-DPI acceptance.
- Live memory/Hindsight recovery and fresh-machine installation of this version
  remain separate acceptance work. Deterministic fixtures are identified in the
  [implementation record](docs/FIELDNOTES_COMPUTER_IMPLEMENTATION.md).
- Earlier published tags and assets remain unchanged.


## 1.0.2 — 2026-09-29

### Added

- Persistent warning popup control in Settings → Appearance and a **Silence warnings** action on advisory notices. Task errors, data failures, approvals and required answers remain visible; inline status and support diagnostics are retained.

### Changed

- Browser tabs, navigation, address entry and agent access use a compact responsive layout, with a useful first-page guide and a separate grant dialog.
- GitHub repository readiness is shown separately from CLI login. Non-Git projects remain usable in Chat and Files without repeated background Git error popups.

### Fixed

- Late PDF extraction replacing the selected page text; OCR from a previous page appearing under the current page; obsolete PDF text layers continuing to render.
- Password-protected PDFs passing worker verification but failing to display because the viewer did not receive the in-memory password.
- A document-worker queue race that could exceed the two-worker limit when a new request arrived during a queued slot handoff.
- Delayed GitHub pull-request details replacing a more recently selected review.
- Recovery **Open settings** targeting an invalid tab, and a completed recovery action dismissing a newer issue.
- Dismissed, unchanged background warnings reappearing on the next poll and covering release notices.
- Docker dependency checks timing out with a generic error instead of an explanation and startup/retry actions.
- Appearance and warning preference changes unnecessarily reconfiguring decision and MCP services.
- Non-Git folders being reported as clean repositories and Git actions appearing available before repository prerequisites were satisfied.

### Known limitations

- Windows installers remain unsigned and require manual installation. Warning muting changes popup presentation only.
- Automated UI evidence uses hidden Windows test windows; native desktop placement and assistive-technology acceptance are not established by those checks.

## 1.0.1 — 2026-09-29

### Replacement build (same version, private release)

- **Added:** live in-app project browser tabs, separate per-project sign-ins, user takeover/handback, exact-origin agent grants, and a bounded BrowserDo action using the configured Jev engine only with project and origin cloud consent. The previous isolated Playwright browser remains available for specialist workers and recovery.
- **Added:** app-wide built-in PDF reading, PDF parsing, OCR, Markdown, and browser-use skills. The PDF reader offers page navigation, zoom, search, selectable text, page references, and locally processed English/Arabic OCR with checksum-pinned language data. Agent document tools remain project-bound or require an explicitly attached external PDF.
- **Changed:** Agent team (subagents) terminology and prerequisite guidance distinguish Git installation, repository root, and initial commit. A clean worktree or GitHub login is not required.
- **Changed:** assistant text from delta-capable providers appears while generating. Final responses remain authoritative; bounded partial text is labelled incomplete on failure. Newly arrived nonstreaming answers receive a brief entrance effect.
- **Fixed:** mixed-case Jev Choice/Noul/Score types, premature memory-provider replacement and failed-key rollback, raw/empty compact timeline entries, misleading clean Git status after errors, clipped Settings tabs, inconsistent Workflow/Diagnostics tab selection, and overly wide Context layout.
- **Known limitations:** Same-version replacement cannot be announced to an existing 1.0.1 installation; reinstall manually. The installer remains unsigned. GitHub Actions billing blocked the replacement's hosted build and attestation; the owner explicitly authorized a locally built, unattested replacement. BrowserDo stops before consequential actions and may return uncertain; use a precise browser action or take over. PDF editing and form submission remain outside this version.

### Added

- App-wide Hindsight memory with cross-project recall, source attribution, an explicit scope/destination consent step, and a resumable migration of existing records.
- Evidence-linked activity summaries from the separately configured memory model, alongside durable factual events and approved plan stages.
- A shared searchable Codex model catalog for chat, memory and specialist profiles, with pagination, refresh, input/reasoning metadata and explicit access-rejection states.
- Release notifications using GitHub's public API: optional startup/daily checks, Stable/Preview channels, remembered dismissals, and a link to release notes and manual downloads.

### Changed

- Files & skills opens in a bounded desktop picker or narrow-window sheet with keyboard navigation and independent scrolling.
- Cobalt, red, steel-gray and white branding is applied across both themes, the UC mark, primary/selected controls, terminal colors and editor diffs.
- Material 3 Expressive feedback remains responsive to reduced motion, with stationary streaming text and logs.
- Structured provider issues distinguish refusals, authentication/access restrictions, quota, rate limits, unsupported options and context limits.

### Fixed

- Provider refusals being reported as successful work; failed turns and accepted question answers now remain durable for deliberate recovery.
- Unchanged plan updates resetting milestone progress or approval, and late timeline summaries surviving newer failures or plan progress.
- Integrated specialist memory being marked shared before a pending private-bank save actually reached the shared bank.
- Queued memory inference dispatching after disable/stop, incomplete startup cleanup, and shutdown rethrowing an already-rejected metadata action.
- Separate retention/observer budgets admitting too many requests; shared reservation preserves deduplication and measured usage.
- Optional memory failures hiding factual timeline history and compact timeline pagination skipping events.
- Docker child-process cleanup, PostgreSQL's temporary initialization-server readiness race, and observer settlement during recovery maintenance.
- Native controls being forced into dark mode while Light was selected, plus attachment and compact-navigation regressions.

### Upgrade and known limitations

- **Unsigned Windows installer.** SHA-256 hashes verify against the release manifest, not publisher trust. The replacement 1.0.1 build has no GitHub Artifact Attestation. See [verification instructions](desktop/VERIFY_RELEASE.md).
- **Install 1.0.1 manually**, including when upgrading from 1.0.0. Release notifications open GitHub; they do not download or execute installers. Automatic checks can be disabled in Settings → Recovery.
- Docker Desktop's Linux engine remains required. Optional memory/browser/model runtimes download separately.
- Memory remains optional. Accept global scope before migrating existing project memories. Disabled memory stays disabled, and unintegrated worker findings remain task-scoped.
- Original project/profile paths remain required for recovery import. Full assistive-technology acceptance and an isolated matched-task memory-overhead benchmark remain unestablished.

## 1.0.0 — 2026-09-28

- Public-source Windows 1.0 release of UnrealCode, built on Unreal Agent with Docker execution, review/recovery workflows, optional integrations and measured usage.
- Published unsigned installer, SHA-256 manifest, annotated Git tag and verified GitHub Actions build attestation.

See the [GitHub releases](https://github.com/MCShotty/UnrealCode/releases) for downloads and earlier version notes. Published tags and assets are preserved.
