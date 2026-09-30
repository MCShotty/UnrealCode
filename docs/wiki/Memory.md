# Memory

Memory is optional, app-wide retained knowledge. It uses local Hindsight and PostgreSQL/pgvector containers, with a separately chosen inference model.

## Set it up

1. Open **Settings > Memory**, even without an active project.
2. Choose the provider and model, and set an endpoint if needed.
3. Check credentials and choose **Save, test & turn on**.
4. Review the model destination and sharing scope. Enable **Use app-wide memory** after verification.

The memory model can differ from chat. Provider credentials are shared: changing a provider key here also changes the key used by chat for that provider. Codex login stays external.

Docker services and pinned models are prepared on demand. Coding remains available if memory is down. A failed provider switch preserves the working profile and retained knowledge.

## What it remembers

After settled work, bounded decisions, corrections, and verification outcomes can be retained. Relevant knowledge is recalled across trusted projects with project, session, workspace, time, and revision references.

Unintegrated worker knowledge stays task-scoped. Current files, logs, and instructions take priority over stale memory. Historical chats are not all ingested when you turn it on.

The same model can interpret saved Fieldnotes and summarize activity. Timeline requests are coalesced to at most one per conversation every 20 seconds, with two global inference slots.

## Manage it

Open **Memory** or `/memory` to browse, search, inspect, correct, forget, reflect, export, or rebuild. Forgetting uses tombstones to prevent immediate reingestion. Disabling processing preserves stored knowledge.

Existing project memories need expanded-scope consent before migration. Backups, provenance, corrections, and pending deletions are preserved. Live populated-bank recovery remains a separate acceptance gap in 1.0.3.
