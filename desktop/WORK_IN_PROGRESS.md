# Active roadmap work

Canonical checkout: I:\UnrealCode; branch codex/desktop-roadmap. Preserve I:\UnrealGUI.

## Published and verified

0.6.1 (7a8dde2), 0.7.0 (abd40f4), 0.8.0 (8b8539f).
0.9.0 acceptance is complete; see RELEASE_0.9.0.md and ROADMAP_STATUS.md.
Final installer SHA-256: E0772E933C14A6F1465F3345C278769E6A7C5231220E38A5D371ECA1A5CDF1D4.
Latest packaged team fixture: Temp/unrealcode-teams-qa-j0LLgR. All checks passed,
including queue cancellation, retained worker review, restart and request limits.
87 desktop tests passed on final code. Source/payload credential audit: 875
files/artifacts, 198 reviewed packages, seven local values, zero hits.

## Next: 1.0

Implement guided setup, signed-update infrastructure, backup/export/import and
recoverable migrations (including durable Docker sessions), storage previews,
redacted support bundles, public-source docs/audit and accessibility/long-session
checks. Stable release requires real Windows signing and fresh-machine evidence.
Do not call an unsigned candidate a completed stable 1.0.

Known focused improvements: reopening a long chat loads its first 3000 events
instead of the latest window; model-facing TeamStatus needs bounded output.

## Environment

The user requests virtual desktop 2. Their Ready reply did not match the Windows
registry's desktop-1 state. Do not switch desktops with unsupported controls.
All subsequent app tests use software offscreen rendering with isolated user data.
Native window placement/chrome is unverified.
Hosted Actions run 36262688853 never started due account billing/spending limits.
Signing-method question remains unanswered. No new API key; existing Codex login.
No subagents. Never print credentials. Continue 1.0 independently of signing.
