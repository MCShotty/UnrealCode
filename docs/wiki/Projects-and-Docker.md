# Projects and Docker

## Project trust

Opening a folder asks you to trust it before mounting its files into the project container. Review unfamiliar repositories first. Approved commands can change mounted files and use the container network.

Use **Projects** to open or switch projects. Recent projects and trust are stored in your app profile.

## What Docker does

UnrealCode checks the installed Docker CLI and Linux engine, builds an image from bundled backend source when needed, and starts the appropriate project or task container. It stores canonical chat sessions in durable Docker volumes.

It does not install Docker Desktop for you. Installing Docker alone is not enough if its daemon is stopped or it is using Windows containers.

Cached conversations can be browsed with Docker stopped. Running tools, continuing a session, and container-based services need the backend.

## Isolated tasks

An isolated task uses an app-owned Git worktree instead of editing the original project directly. Check the snapshot and omitted files before working. Review changes before integrating them back.

Git, the repository root, and an initial commit are required. A clean working tree and GitHub login are not prerequisites. Worktrees can be retained, archived, and restored through the app.

Do not delete session volumes to solve a connection or cache problem. Use [Storage and recovery](https://github.com/MCShotty/UnrealCode/wiki/Storage-and-recovery) to inspect ownership and retained data first.
