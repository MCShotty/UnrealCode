# Files and terminal

## Files

Open **Files** to browse the active workspace. Monaco supports tabs, syntax highlighting, search and replace, unsaved buffers, and selection-to-chat. Check which workspace is active before editing an isolated task.

Save deliberately. Reloading a changed file must not replace a different selected tab or discard an unsaved buffer without review. Native file operations check revisions and refuse stale writes.

File access stays inside the trusted workspace. Junctions, traversal, and concurrent path changes are checked through opened directory handles. Hard links and ReFS are unsupported by the host file helper.

## Terminal

Open **Terminal**, or press Ctrl and the backtick key. Commands run in the project container, not a general Windows shell. That distinction matters when installing dependencies or configuring container MCP servers.

Commands can change mounted project files and use the network. Docker is not a reason to trust unfamiliar code.

For a long-running preview or service, use a [background job](https://github.com/MCShotty/UnrealCode/wiki/Workflows-jobs-and-hooks). It keeps ownership, logs, state, and cancellation visible instead of relying on a terminal tab staying open.

Use **Review** to inspect file changes before integration or selective checkpoint restoration.
