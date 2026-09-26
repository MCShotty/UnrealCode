# Contributing to UnrealCode

UnrealCode builds a Windows desktop around the Unreal Agent harness. The original
Unreal Labs history and MIT attribution are retained. Desktop contributions belong
in `desktop/`; reusable backend changes belong in the Go bridge or harness.

See [desktop/README.md](desktop/README.md) for setup and
[desktop/BUILDING.md](desktop/BUILDING.md) for reproducible checks and packaging.
Open an issue describing the problem and intended scope before a large change.
Keep unrelated formatting and generated assets out of patches. Add regression
coverage for behavior changes, including cancellation and restart where relevant.

Preserve parallel tools, live steering, project boundaries and measured usage.
Do not weaken an approval check or give a decision model permission authority.
Do not include API keys, external login files, app data, real project content,
signed certificates, or recovery backups in a pull request.

Report vulnerabilities privately following [SECURITY.md](SECURITY.md).
Contributions are distributed under the repository's existing MIT license.
