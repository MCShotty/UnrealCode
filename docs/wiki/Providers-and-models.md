# Providers and models

Open **Settings > Provider** to choose how coding requests run.

| Provider | Setup |
| --- | --- |
| ChatGPT / Codex | Use the installed Codex CLI's existing login. Sign-in and refresh happen outside UnrealCode. |
| OpenAI | Save an API key. |
| Anthropic Claude | Save an Anthropic API key. Claude subscription login is not supported. |
| OpenRouter or Fireworks | Save the matching provider key. |
| Ollama | Start your local server and choose an installed model. |
| OpenAI-compatible | Set the server base URL and a key if it needs one. |

Keys stay in Electron main. Saved keys use Windows encryption when available; otherwise they remain in memory for that app run. Do not put keys into URLs or project instructions.

## Choose a model

The shared selector is used by chat, memory, and role profiles. Codex discovery reads the installed CLI's paginated catalog and caches it for five minutes. Refresh after login changes.

A listed model is different from a model explicitly rejected by your account. Hidden or omitted entries are not proof of denied access. Manual IDs are marked unverified. Image input, reasoning options, context limits, and speed tiers vary by provider and model.

## Change an existing conversation

Use the reviewed provider handoff flow. It previews the continuation and creates a linked session. Changing a default does not silently move an existing conversation to another provider.

`/fast` requests a supported provider speed tier. It does not change models or lower reasoning effort. Unsupported tiers stay unavailable; usage distinguishes requested and actual processing.

Refusals, access denial, expired login, quota, rate limits, and incomplete responses remain visible. Use the suggested recovery action or deliberately retry. Accepted answers and completed tools are not automatically replayed.
