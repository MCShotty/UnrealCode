# Chat and sessions

Use **Chat** for the selected conversation and **Sessions** to browse, search, resume, rename, or fork conversations. Switching away keeps drafts and editor buffers.

## Send, steer, or stop

- Type a message, attach an image, or choose files and skills, then select **Send**.
- You can send a new message while work runs. It becomes live steering.
- With no draft, the same button becomes **Stop** while work is active.
- **Task options > Stop task** and `Ctrl+Shift+.` remain available when you have a draft.
- Enter sends a valid draft. Shift+Enter adds a line. Empty Enter never stops work.

Messages stream when the provider supplies text deltas. Other responses arrive with a short entrance effect. A failed stream keeps a bounded partial response labelled incomplete.

## Work and questions

Running work is expanded; settled work normally collapses. Open the disclosure to inspect progress and tools. Final answers, unanswered questions, and actionable failures stay visible.

A question card can contain choices and free text. Selecting a choice does not send it. Use **Submit answers**. Required questions pause the requesting agent; independent work can finish. Background questions let work continue and can be dismissed.

Answers have durable receipts. After an interruption, **Answer and resume** is explicit. Ordinary chat messages are steering, not replies to every pending question.

## Restart and offline use

History and recorded outcomes survive restart. Interrupted commands, goals, jobs, workers, and queues do not start themselves again. Cached history is available offline; execution needs the backend. A fork keeps prior context without deleting the original conversation.
