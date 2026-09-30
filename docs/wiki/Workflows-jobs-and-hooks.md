# Workflows, jobs, and hooks

## Workflow

The **Workflow** page contains the task queue, context selection, provider handoff, conversation search, and saved workflows.

Each project's queue runs tasks sequentially. Other projects can run concurrently. Reorder or edit queued prompts before starting them. Failure, required input, interruption, and integration can pause the queue. Restart needs an explicit queue resume.

Provider handoff previews a continuation into a linked conversation. It does not quietly change the current provider.

## Saved workflows

Save reusable review, test, or fix prompts and named verification commands. A verification profile includes its command and timeout. Inspect its exit code and output.

Repair loops are opt-in and bounded by the configured attempt limit. A prompt that says tests passed is not the same as a successful verification result.

## Background jobs

Use **Task controls** to start and inspect background commands. Jobs have a workspace owner, logs, timeout, state, and exit code. Stop them when finished. The agent can also use bounded start, status, log, wait, and stop tools.

After restart, uncertain jobs are marked interrupted. They are not rerun silently. Preview ports belong to the exact task workspace and approved ports are exposed only on loopback.

## Hooks

**Hooks** runs reviewed project commands before or after tools, at turn completion, or during verification. Set a timeout and tool match, then review the definitions before trusting them.

A pre-tool hook may reject an action. It cannot approve that action. Editing a hook requires renewed trust; normal permissions still apply. Hooks run in the project container.
