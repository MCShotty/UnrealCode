# Changelog

## 1.0.1 — 2026-09-29

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

- **Unsigned Windows installer.** SHA-256 hashes and GitHub Artifact Attestations verify integrity/provenance, not Windows publisher trust. See [verification instructions](desktop/VERIFY_RELEASE.md).
- **Install 1.0.1 manually**, including when upgrading from 1.0.0. Release notifications open GitHub; they do not download or execute installers. Automatic checks can be disabled in Settings → Recovery.
- Docker Desktop's Linux engine remains required. Optional memory/browser/model runtimes download separately.
- Memory remains optional. Accept global scope before migrating existing project memories. Disabled memory stays disabled, and unintegrated worker findings remain task-scoped.
- Original project/profile paths remain required for recovery import. Full assistive-technology acceptance and an isolated matched-task memory-overhead benchmark remain unestablished.

## 1.0.0 — 2026-09-28

- Public-source Windows 1.0 release of UnrealCode, built on Unreal Agent with Docker execution, review/recovery workflows, optional integrations and measured usage.
- Published unsigned installer, SHA-256 manifest, annotated Git tag and verified GitHub Actions build attestation.

See the [GitHub releases](https://github.com/MCShotty/UnrealCode/releases) for downloads and earlier version notes. Published tags and assets are preserved.
