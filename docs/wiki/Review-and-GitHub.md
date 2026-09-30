# Review and GitHub

## Review changes

**Review** brings together changed files, diffs, verification results, worker findings, and comments. Compare files side by side or in a unified view. Send a review comment as steering for another repair pass.

An isolated task's changes are not automatically integrated. Preview the selected files and conflicts first. Later conflicting edits must be reviewed rather than overwritten.

Turn checkpoints support selective restoration. Inspect the preview, including added, deleted, binary, and uncaptured files. An incomplete checkpoint is not proof that every change was saved. Restoration records recovery data before changing files.

## GitHub

The **GitHub** page uses installed Git and your existing `gh` login. It supports repository browsing and cloning, branches and worktrees, changes, staging, commits, pushes, PRs, checks, and creating local tasks from issues or review comments.

GitHub sign-in and local repository readiness are separate. A signed-in account does not make a plain folder a repository. Failed Git queries must not appear as a clean working tree.

Review previews before remote submissions. Creating a local task, making a commit, pushing, and opening a PR are different actions.

Use **Fetch** to update remote information before deciding whether to pull or push. Inspect pending changes before repository operations. UnrealCode does not silently initialize Git to make Agent team work.

For lost or retained workspaces, see [Storage and recovery](https://github.com/MCShotty/UnrealCode/wiki/Storage-and-recovery).
