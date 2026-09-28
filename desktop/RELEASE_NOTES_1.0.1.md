# UnrealCode 1.0.1

The installer is unsigned; upgrades remain manual. Verify its SHA-256 manifest and GitHub build attestation before installing. Version 1.0.0 requires a manual upgrade to receive the new release-notification feature.

## Changes

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

See the [changelog](https://github.com/MCShotty/UnrealCode/blob/v1.0.1/CHANGELOG.md), [verification guide](https://github.com/MCShotty/UnrealCode/blob/v1.0.1/desktop/VERIFY_RELEASE.md), and [acceptance evidence](https://github.com/MCShotty/UnrealCode/blob/v1.0.1/desktop/ACCEPTANCE_1.0.1.md). Local candidate checksums are separate from the published artifact hash below. v1.0.0's tag and release assets are unchanged.
