# Decision checkpoint smoke comparison

Windows Docker Desktop, 2026-09-25. Each row is one live Codex run in an isolated temporary Git workspace. The response was checked against the requested file or directory. These are smoke measurements, not a performance distribution or proof of quality improvement.

| Task | Engine | End-to-end time | Exact outcome | Decision batches |
| --- | --- | ---: | --- | ---: |
| Run `pwd` and return its path | Off | 9,455 ms | `/workspace` | 0 |
| Same path task, before the trivial-task gate | Jev | 14,037 ms | `/workspace` | 1 |
| Create and verify `checkpoint.txt` | Off | 11,003 ms | `QA_CHECKPOINT_OK` in file and reply | 0 |
| Same file task | Jev | 9,452 ms | `QA_CHECKPOINT_OK` in file and reply | 2 |

The path task showed no quality gain and added latency, so automatic preflight now skips it. Code-change requests still receive a batched preflight, and a Git change receives a focused asynchronous post-change batch. Both file-task runs passed; the observed timing difference is too small a sample to attribute to Jev. The post-change result is advisory and cannot authorize actions. Broader task sets and repeated trials are needed before claiming a quality or speed improvement.

Commands: `node scripts/qa.mjs --workspace --temp-workspace --live --tool --benchmark`, `node scripts/qa.mjs --workspace --temp-workspace --decision --live --tool --benchmark`, and corresponding `--github-actions --implementation` runs for the file task. The runner uses separate temporary app data and project folders, then removes them.
