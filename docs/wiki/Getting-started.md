# Getting started

## What you need

- Windows and Docker Desktop using its Linux container engine.
- A model provider account or a running local model server.
- An NTFS project folder. The host file helper does not support ReFS or hard-linked files.
- Git for repository features. GitHub CLI is needed only for GitHub integration.

The installed app includes its Computer helper. You do not need to install a .NET SDK to use the installer.

## Install

1. Download the installer and `SHA256SUMS` from the same [release](https://github.com/MCShotty/UnrealCode/releases).
2. Follow the [checksum and attestation guide](https://github.com/MCShotty/UnrealCode/blob/main/desktop/VERIFY_RELEASE.md).
3. Save your work and close an older UnrealCode installation before upgrading.
4. Run the installer. Windows may show an unknown publisher because it is unsigned.

## First project

1. Configure a provider in **Settings > Provider**.
2. Start Docker Desktop and wait for the Linux engine.
3. Choose **Open project folder** and review the trust prompt.
4. Let UnrealCode prepare its bundled backend. The first image build can take time and needs network access.
5. Start a conversation in **Ask** mode. Try: `Inspect this project and explain how to run its tests.`

You can skip optional decision models and memory. Neither is required for chat. A plain folder can be used without Git; isolated tasks and Agent team need a repository with an initial commit.

Already have a project open? Use **Projects** to switch. [Troubleshooting](https://github.com/MCShotty/UnrealCode/wiki/Troubleshooting) covers startup and connection failures.
