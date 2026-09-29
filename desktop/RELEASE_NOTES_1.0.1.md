# UnrealCode 1.0.1

The installer is unsigned; upgrades remain manual. Verify its SHA-256 manifest before installing. This corrected **same-version replacement** was built locally after GitHub Actions refused to start runners for the private repository; **it has no GitHub Artifact Attestation**. Existing 1.0.1 installations cannot receive a newer-version notice for it and require a manual reinstall; 1.0.0 also requires a manual upgrade.

## Changes

- Live in-app browser tabs use separate project sign-ins. Users can browse without a chat; agent observation, interaction, and Jev BrowserDo need exact-origin grants and explicit tab handback. BrowserDo uses the selected Jev engine only with project and origin cloud consent, and stops for uncertain or consequential actions. The old isolated browser remains available for worker tasks and recovery.
- Built-in, read-only PDF reading/parsing, OCR, Markdown, and browser-use skills work across projects. The PDF reader has page navigation, zoom, search, selectable text, and English/Arabic OCR. Document agent tools remain trusted-project-bound or require an explicitly attached external PDF.
- Streamed assistant text appears while supported providers emit deltas. Failed streams retain a labelled, bounded incomplete response; final responses remain authoritative. Nonstreaming answers receive a brief entrance effect.
- Agent team (subagents) now explains Git prerequisites separately from GitHub login and dirty changes. Jev Choice/Noul/Score names normalize to the TypeSafe wire format, retaining probabilities and measured usage.
- Memory-provider switches test the candidate before replacing a working profile and restore the previous model/key if startup fails. Compact activity uses a concise typed stage rail rather than raw transcripts or empty operation payloads. Git failure states no longer masquerade as clean repositories.

- Release notifications check GitHub when due after startup and at most once daily. Choose Stable/Preview, disable automatic checks, or check manually under Settings → Recovery. A dismissible notice opens the release/changelog page; installers are never downloaded or executed automatically by this unsigned build.
- Files & skills now opens in a contained picker with separate file and skill views, keyboard controls, and a compact bottom sheet at narrow widths.
- Shared model discovery brings the installed Codex catalog to chat, memory, and specialist settings. Catalog visibility is distinguished from an explicit access rejection.
- Memory can be enabled once for the app, with relevant recall across projects and source attribution. Existing project memories receive a verified metadata backup and resumable migration after the user accepts the broader scope.
- The configured memory model can summarize live activity in bounded batches. Summaries cite session events and show inferred plan stages without changing approved plans.
- Plan progress updates preserve milestone identities and approval. An unchanged PlanUpdate no longer resets completed milestones.
- Provider refusals and account, model, quota, rate, and context restrictions retain structured failure information. Refusals no longer count as completed work or automatically retry.
- Picker transitions, attachment feedback, progress shapes and small completion effects reuse Material 3 Expressive motion. Reduced motion, hidden windows and stationary text are respected.
- The supplied cobalt, red, steel-gray and white palette now carries through primary actions, selected controls, surfaces, the UC mark, terminal ANSI colors and editor diffs. Light mode also fixes a legacy rule that forced native controls into dark mode.
- Docker project containers use an init process to reap orphaned children. Memory startup waits for PostgreSQL's final TCP server rather than its temporary initialization server.
- The follow-up bug hunt fixes specialist memory promotion races, late inference dispatch after stopping, stale timeline summaries, factual-history fallback during memory failures, shared memory budget enforcement, and shutdown after rejected metadata actions.

## Data and recovery

Global memory is optional and uses the separately configured model. The provider receives bounded task outcomes and activity excerpts; credentials remain in Electron main. Unintegrated specialist findings stay scoped to their task until reviewed integration. Existing disabled memory stays disabled. Restoring a backup clears global memory consent and model verification.

Timeline observations use registered timestamp filenames and are included in private backups. SQLite remains a rebuildable cache with one writer and two readers. Cache rebuilding does not regenerate historical model summaries.

See the [changelog](https://github.com/MCShotty/UnrealCode/blob/v1.0.1/CHANGELOG.md), [verification guide](https://github.com/MCShotty/UnrealCode/blob/v1.0.1/desktop/VERIFY_RELEASE.md), and [replacement acceptance evidence](https://github.com/MCShotty/UnrealCode/blob/v1.0.1/desktop/REPLACEMENT_ACCEPTANCE_1.0.1.md). The published artifact hash appears in the release manifest. v1.0.0's tag and release assets are unchanged.
