# UnrealCode 1.0.3

An app-wide Fieldnotes library, managed Computer controls, clearer Abilities,
three named themes, and the reliability repairs from the latest bug hunt.

## Added

- **Fieldnotes:** author guidance in its own app-wide section; attribute it to a
  project or project/session, include or exclude it per request, inspect exact
  revision receipts, and use originals offline. Optional memory interpretation
  shares the configured memory destination and bounded inference pool.
- **Computer (experimental):** a bundled selected-window Windows helper and skill,
  task/model-bound observation or routine interaction grants, takeover, explicit
  handback, a chat companion, transient screenshots, and Ctrl+Alt+Shift+. to stop.
  It is disabled by default. Website tasks use the shared Browser.

## Changed

- **Abilities** groups Skills and MCPs into separate sections.
- **Cinder Dark**, **Ice Dark**, **Flashbang**, and **Follow Windows** retain the
  theme choices with consistent Material 3 Expressive navigation and feedback.
- Windows CI exercises the packaged Fieldnotes, Computer startup, reliability,
  and delayed-navigation regressions before release.

## Fixed

- Guidance replay, duplicate receipt ownership, partial cache updates/rebuilds,
  withdrawal and out-of-order configuration races.
- Stale editor, session and Fieldnote results; skill collisions; MCP revocation
  and paging; memory/timeline evidence and attribution races.
- Computer startup/stop, reviewed model destinations, task isolation and capture
  bounds; browser uploads after cancellation or grant/control changes.
- Shutdown write barriers, failed goal persistence, model-facing metadata
  redaction, and automatic-memory exclusion for native-derived content.

## Installation and limitations

The installer is **unsigned**. Verify `SHA256SUMS` and the GitHub build attestation,
save work, close UnrealCode, then install manually. Release notifications open
GitHub and do not download or execute an installer. Existing releases remain intact.

Packaged UI and helper authority tests do **not** establish real native typing,
clicking, screenshot masking, physical takeover, lock/unlock, desktop switching,
or mixed-DPI behavior. Computer remains experimental. Live Hindsight/model recovery,
fresh-machine installation of this version, and full assistive-technology acceptance
remain unverified. See the [implementation evidence](../docs/FIELDNOTES_COMPUTER_IMPLEMENTATION.md)
and [verification guide](VERIFY_RELEASE.md). No historical benchmark is presented
as a measurement of this released artifact.
