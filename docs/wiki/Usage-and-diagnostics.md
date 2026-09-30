# Usage and diagnostics

## Usage

**Usage** shows provider-reported values when available: input, output, cache, reasoning, request counts, decision usage, and session totals. Agent team also separates parent, worker, and combined usage. Memory has its own usage, including timeline analysis.

Codex subscription percentages come from reported account limits, not a conversion from tokens. Optional OpenAI and Anthropic organization reports use separate admin credentials and can include other applications' usage.

Unknown data remains unknown. Context limits, latency, cached tokens, and requested versus actual speed depend on what the provider reports. UnrealCode does not invent dollar costs or promised savings.

## Diagnostics

The **Diagnostics** page has local-model health, decision trace, and evaluation views.

- **Local model health:** inspect a configured local endpoint and model before relying on it.
- **Decision trace:** inspect the selected engine's question, focused evidence, result, probabilities, measured usage, and latency.
- **Evaluations:** run an explicitly selected paired comparison on disposable tasks and worktrees, with criteria, test commands, and limits.

Jev uses bounded Choice, Noul, and Score judgments. Laya is an optional local decision worker. GLiNER is separate local entity extraction. The app never switches engines silently.

Evaluate actual task results, not confidence alone. A decision result cannot grant tools or permissions. Share redacted diagnostics when reporting a reproducible problem, and keep private project content out of public reports.
