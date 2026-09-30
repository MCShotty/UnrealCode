# Computer

**Experimental in 1.0.3, off by default.** Computer gives the main agent access to selected Windows application windows. Website tasks should use the shared Browser.

## Grant access

1. Open **Computer**, `/computer`, or the chat companion.
2. Enable the feature and find available windows.
3. Choose only the windows needed for the task.
4. Review observation or routine interaction access, the conversation, and its model destination.
5. Grant access. Unknown or consequential actions still need exact-operation approval.

Windows must be unlocked and monitored, and UnrealCode must not run as administrator. A missing input monitor, unavailable desktop, incompatible helper, or failed integrity check blocks startup with a reason.

Plan mode observes only. Subagents cannot use native input. Personal browsers, elevated windows, and UnrealCode's own permission controls are excluded from input access.

## Take over or stop

Physical input pauses control. Use **Hand back** explicitly to continue. **Stop**, disabling Computer, or `Ctrl+Alt+Shift+.` revokes access. Window identity, geometry, DPI, desktop changes, helper death, and restart can invalidate access. Grants are not restored automatically.

One task owns native input at a time. A click is a dispatch, not a verified save or submission.

## Captures and limits

Window text and requested captures can reach the task's model. Password fields are concealed where Windows identifies them; keep other sensitive content out of selected windows.

Unpinned captures expire in memory and are not raw image bytes in canonical logs. **Attach evidence to chat** deliberately makes a normal attachment. Native-derived content is excluded from automatic memory.

Packaged startup and authority tests passed. Actual clicks, typing, capture masking, physical takeover, lock/unlock, desktop transitions, and mixed-DPI acceptance remain unverified. See the [implementation record](https://github.com/MCShotty/UnrealCode/blob/main/docs/FIELDNOTES_COMPUTER_IMPLEMENTATION.md).

For an older 1.0.2 installation, see the [legacy MCP add-on](https://github.com/MCShotty/UnrealCode/wiki/Windows-computer-use-add-on).
