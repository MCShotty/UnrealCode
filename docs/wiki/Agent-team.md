# Agent team

Agent team is UnrealCode's subagent system. The main agent delegates a bounded assignment to a worker, then reviews its findings or changes.

## Choose a policy

Open the composer's **Task options** or **Task controls**.

- **Off:** no worker dispatch.
- **Manual:** you launch a worker with an assignment.
- **Automatic:** after project opt-in, the main agent can delegate useful independent work within the task's limits.

Apply changes to save them. Cancelling or dismissing Task options discards its unsaved edits. New-task drafts and existing task settings are separate.

## Roles and limits

Explorer, implementer, reviewer, and browser tester are the built-in roles. Profiles can override provider, model, reasoning, instructions, tool restrictions, and limits. They initially inherit the parent. An unavailable profile produces an error, not a substitute model.

Default concurrency is two workers per task, with four allowed globally. Per-task concurrency can be raised to four. The default total-worker limit is four; request, time, and token limits can also be set. Empty task-limit fields mean unlimited.

Assignments need ownership, a clear expected result, and acceptance criteria. Workers inherit restrictions and cannot delegate again or compete for managed Computer input.

## Review and integrate

Workers use isolated Git worktrees. Inspect findings, test evidence, and conflicts before integrating selected changes. You can steer, follow up, cancel a worker, or stop the team. Usage shows parent, worker, and combined totals.

This feature needs Git, the repository root, and an initial commit. GitHub login and a clean working tree are not required. Restart requires explicit resumption.
