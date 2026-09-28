# Optional runtimes — local preview inventory

Checked 2026-09-27. These runtimes download during explicit setup and are not
embedded in the NSIS installer. Keep upstream notices with the downloads.
This inventory does not clear republishing container images or model archives.

| Component | Pin | Source / license |
| --- | --- | --- |
| Playwright Core | npm 1.63.0 | Apache-2.0; LICENSE and ThirdPartyNotices in generated npm notices |
| Dedicated Chromium | Playwright revision 1243, Chromium 153.0.8010.12 | Chromium component licenses retained by the upstream archive |
| Hindsight API | v0.10.1, amd64 digest `ba46d6f4ecadb93f71747428e39fd429df0e0adfc0c066b76a365c06b219db8b` | [MIT](https://github.com/vectorize-io/hindsight/blob/v0.10.1/LICENSE) |
| PostgreSQL / pgvector | pg17 digest `dca0d688bbb31d3f851502ffcb9c7791387b4fcc544ae434dab41761e5ece317` | [PostgreSQL-style license](https://github.com/pgvector/pgvector/blob/master/LICENSE); OS notices remain in image |
| Local embeddings | BAAI/bge-small-en-v1.5, revision `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a` | [MIT model card](https://huggingface.co/BAAI/bge-small-en-v1.5) |
| Local reranker | cross-encoder/ms-marco-MiniLM-L6-v2, revision `233902d25c440f23af6f7d6e94d2946bac0bee0a` | [Apache-2.0 model card](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2) |

Only JSON/text/Safetensors model files at those revisions are downloaded; remote
model code is disabled. Hindsight has a dedicated cache, private database network,
3 GiB API and 512 MiB database limits, and no published API/database ports.
Coding-provider credentials stay in Electron main. Its memory gateway receives a
process-scoped bearer capability over stdin, not the user's provider credential.

Before separately authorized distribution, repeat the payload audit and review
upstream archive notices and container transitive packages. Signing and
fresh-machine acceptance remain external release gates.
