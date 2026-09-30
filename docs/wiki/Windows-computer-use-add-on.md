# Legacy Windows computer-use add-on

This is the optional MCP route for an existing **1.0.2** installation. **1.0.3** adds a separate, default-off [Computer feature](https://github.com/MCShotty/UnrealCode/wiki/Computer). The two are not the same permission model.

## Install and connect

1. Review the [add-on instructions and pinned installer script](https://github.com/MCShotty/UnrealCode/blob/main/integrations/windows-computer-use/README.md).
2. Run `integrations/windows-computer-use/Install.ps1` from a reviewed repository checkout. It downloads and verifies the upstream executable, then prints the path and JSON arguments. It does not run the server or grant access.
3. In the older app's Connections page, add a Windows stdio connection using those exact printed settings.
4. Review Windows host trust, grant project access, connect, and select only needed tools.

The default installation is `%LOCALAPPDATA%\UnrealCode\Addons\WindowsComputerUse\v1.3.25`. Each MCP call still needs approval. The server runs with your Windows account's access; its tool allowlist is not a sandbox. Plan mode cannot execute it.

1.0.2 forwards MCP results as text. Visual evidence needs a selected-window screenshot saved to an approved workspace file and then `ViewImage` with a vision-capable model. Such files can enter Git and backups. Follow the source guide's exact capture options.

## Migrate to 1.0.3

The Computer page offers reviewed migration. It preserves the old server configuration and withdraws overlapping grants across projects. Known legacy calls cannot compete while managed Computer is enabled. Other MCP permissions stay unchanged.

Use [Abilities](https://github.com/MCShotty/UnrealCode/wiki/Skills-and-MCP) for general MCP setup, and [Computer](https://github.com/MCShotty/UnrealCode/wiki/Computer) for selected-window grants, takeover, and emergency stop.
