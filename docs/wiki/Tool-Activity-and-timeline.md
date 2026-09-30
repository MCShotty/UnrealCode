# Tool Activity and timeline

These views answer different questions: which operations ran, and which stage the task is in.

## Tool Activity

Select **Tool Activity** or a tool row beside chat to open the full pane. Wide windows use a supporting pane; narrow windows use an overlay.

Running tools come first. Search names or arguments, filter by status, choose current work or all history, and page older calls. A detail view shows arguments, output, errors, exit status, times, duration, workspace, and originating conversation. Large output is paged.

Cancel an active operation individually when available. Historical and interrupted operations do not have live cancellation controls.

The active badge counts unique executing calls. Approval waits and answer waits are separate. Loading and disconnected states are not reported as zero active.

Model time, tool wall time, and overlap have a stated conversation or work scope. Overlapping activity is counted once where appropriate. Unknown timing stays unknown.

## Activity timeline

The timeline uses recorded chat, tools, workers, verification, and lifecycle events. Approved plan stages appear when available; other work uses concise factual stages.

Optional memory-model summaries cite evidence and label inferred progress. They do not edit approved plans or turn an inference into verified completion. Failures, required answers, and failed verification take precedence.

Summaries run at most once per conversation every 20 seconds, with two global inference slots and no repeated idle requests. If memory is unavailable, the factual timeline stays useful. Saved records remain available offline without rerunning historical inference.
