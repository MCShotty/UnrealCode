# Browser

The **Browser** page is a normal in-app browser for the opened project. You can use it without an active chat.

## Browse yourself

Create a tab, enter an HTTP or HTTPS address, and use back, forward, reload or stop. Tabs support page find, zoom, downloads, and ordinary sign-in. Each project has separate browser storage.

Remote pages have no UnrealCode preload, Node access, or privileged app IPC. Personal Chrome and Edge profiles are not imported.

## Hand a tab to the agent

1. Open **Agent access** and review the exact origins.
2. Grant observation, and interaction only where needed.
3. Review that a signed-in page may become visible to the selected model.
4. Hand the tab back when you want the agent to work.

Taking over pauses agent actions on that tab. Handback is explicit. Redirects, frames, revoked grants, and control changes are checked again before actions. Uploads, downloads, and consequential submissions remain permission-bound.

Agent tools provide scoped snapshots, navigation, interaction, screenshots, viewport changes, and error inspection. A dispatched action is not proof of its outcome.

## BrowserDo and local previews

BrowserDo attempts one observable outcome and can report done, uncertain, blocked, or needs confirmation. It uses the selected Jev engine only with both project and origin cloud consent. Laya or Off does not silently switch to Jev; precise browser tools remain the alternative.

Dev-server previews belong to the exact task workspace. Approved ports are published on loopback. Adding a port may require an idle backend restart, which is shown before restarting.

Workers use isolated Playwright browser profiles. Their older runtime is downloaded on demand and kept separate from your shared project tabs.
