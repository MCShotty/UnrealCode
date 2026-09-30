# Planning and goals

The execution mode is visible beside the composer.

| Mode | Use it for |
| --- | --- |
| Plan | Inspection, questions, and planning with dedicated reading tools. |
| Ask | Coding with action approvals. This is the default for new sessions. |
| Agent | Execution within the project's existing permissions. |

Modes do not turn arbitrary commands or MCP tools into read-only operations. Changes wait for safe boundaries.

## Implement a plan

1. Use `/plan` or `/plan your request`.
2. Answer clarification cards and review the proposed approach.
3. In **Task controls**, edit the objective, plan, milestones, and acceptance criteria.
4. Save the revision and choose **Implement this plan** with Ask or Agent execution.

Plan approval does not grant additional permissions. Earlier revisions remain available. Progress updates preserve approved content; substantive edits require a new revision. The activity timeline can show the executing stages.

## Persistent objectives

Use `/goal` or **Task controls** to save an objective with request, reported-token, and active-time limits. Save it paused, then explicitly resume.

Pause when you need to inspect work. Mark it complete after reviewing verification evidence. Missing input, failures, and limits can stop continuation. In-flight requests may exceed a reported-token limit, and missing provider usage is not an exact token measurement.

Restart never resumes an objective automatically. A goal is a bounded continuation of the selected conversation, not a promise of unattended completion.
