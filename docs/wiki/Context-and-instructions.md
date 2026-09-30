# Context and instructions

Open **Context** or `/context` to inspect what the agent is using and where it came from.

## Add context

- Use **Files & skills** to search project files or choose a skill without expanding the composer.
- Attach images only when the selected model supports them.
- Pin relevant files and review reference text before sending.
- Inspect discovered hierarchical `AGENTS.md` instructions.
- Import `CLAUDE.md` compatibility instructions through the review flow.

Repository retrieval returns local file and line references. The optional selected decision engine can rerank focused results when the project has consented.

Exclusions affect context retrieval. They are not filesystem permissions. A skill, retrieved document, Fieldnote, or memory cannot grant tool access.

## Keep context manageable

Compaction creates a model summary at an idle boundary. Original events remain available, and you can restore full history. Pinned files and current instructions stay in context.

Automatic compaction uses 80% of a verified context limit. Unknown limits require manual compaction. Summary requests use the configured provider and count toward its usage.

Review the selected summary and its sources. If guidance conflicts with the current request or code, the agent should flag it and use current evidence.

| Source | Purpose |
| --- | --- |
| Project instructions | Scoped working rules. |
| Skills | Reusable task guidance. |
| Fieldnotes | User-authored suggestions with visible revision receipts. |
| Memory | Recalled knowledge with source attribution. |

Current requests and repository evidence remain authoritative for the task.
