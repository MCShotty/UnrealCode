# Troubleshooting

Start with the visible explanation and expandable technical details. Note the app version, affected project or conversation, and diagnostic reference. Preserve drafts and history before trying recovery.

| Problem | What to check |
| --- | --- |
| Docker CLI missing | Install Docker Desktop and retry dependency checks. |
| Missing Linux engine pipe or daemon unavailable | Start Docker Desktop, wait for readiness, select Linux containers, then retry. Check the active Docker context if needed. |
| Backend build or mount fails | Inspect its details, project access, free space, and backend rebuild action. |
| Git says not a repository | Open the actual repository root. Plain folders remain usable for chat and files. |
| Agent team unavailable | Check Git, repository root, and initial commit. A GitHub login or clean tree is not required. |
| Model denied or login expired | Reconnect the provider, refresh models, and check its stated access reason. |
| Quota, billing, or rate limit | Inspect the provider's exact category and retry/reset guidance. Do not assume more local RAM will solve it. |
| Local model unreachable | Start the server, verify base URL/model, and use Diagnostics health checks. |
| Memory provider switch fails | Check credentials, model verification, and service readiness. The prior working profile and knowledge are preserved. |
| Skill missing | Check `.harness/skills/<name>/SKILL.md`, frontmatter, current project, and `SkillUse`; start or resume after edits. |
| MCP connected but no tools | Grant project access, select current advertised tools, reconnect if needed, and answer per-call approvals. |
| Container MCP command missing | Install it inside the project container; a Windows install is not enough. |
| Computer refuses startup | Remove Run as administrator, unlock Windows, ensure desktop/input monitoring, or reinstall after a helper integrity/protocol failure. |
| File operation unsupported | Use NTFS and avoid hard-linked files. |
| Cache damaged | Rebuild the cache, keeping canonical sessions and originals. |
| Older app shows no newer release | Use Settings > Recovery for a manual check. Unsigned installation remains manual. |

Do not automatically replay a command, upload, or provider action whose outcome is uncertain. Inspect it first. **Retry response** deliberately retries retained model context without resubmitting accepted answers or replaying completed tools.

Export a previewed support bundle for a reproducible issue. Keep backups and project content private. [Security problems](https://github.com/MCShotty/UnrealCode/blob/main/SECURITY.md) belong in private reporting.
