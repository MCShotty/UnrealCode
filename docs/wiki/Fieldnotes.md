# Fieldnotes

Fieldnotes is your app-wide notebook for guidance you write yourself. Open **Fieldnotes**, use `/fieldnotes`, or open it from the welcome screen.

## Write a note

1. Create a note with a title and short, specific guidance.
2. Give it a project pointer, optionally pointing to one of that project's sessions.
3. Review the preview and save it.
4. Enable or disable its guidance and choose whether the memory model may interpret it.

For example: `When changing the checkout, keep keyboard navigation working and verify an Arabic layout.`

The pointer records where the guidance came from. It is not a file-access grant or a strict retrieval boundary. A relevant note can help another project, with its original source still shown.

Originals work offline and with memory turned off. Unsaved drafts stay local. Optional background interpretation uses the separately configured, consented memory destination; the model cannot edit your original note.

## Use it in chat

The composer suggests relevant notes. Include or exclude them before sending. Each accepted request keeps the note revisions and source labels in an inclusion receipt.

The current request takes priority. Among applicable conflicting guidance, session notes take priority over project notes, then other sources. The agent should flag conflicts or stale assumptions instead of treating a note as proof of current code.

Context is bounded to eight complete notes and 16 KiB. If explicit selections exceed the budget, adjust them rather than silently cutting a note.

## Maintain the library

Search, edit, disable, delete, export, or repair a pointer. A missing source folder does not erase the authored note. Editing creates a new revision. Withdrawal prevents future guidance use, including dependent summaries, without rewriting historical chats or backups.

[Memory](https://github.com/MCShotty/UnrealCode/wiki/Memory) is automatic retained knowledge. Fieldnotes are the originals you authored.
