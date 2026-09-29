# Changelog

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
