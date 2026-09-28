# SignPath Foundation application packet (draft)

**Not submitted or approved.** This file prepares a request for free
open-source signing; it does not claim that UnrealCode has a trusted
certificate. The project owner must review SignPath's terms and submit the
application through [SignPath Foundation](https://signpath.org/apply.html).

## Public project evidence

| Requirement | UnrealCode evidence / status |
| --- | --- |
| Public source and open license | [MCShotty/UnrealCode](https://github.com/MCShotty/UnrealCode), MIT license and retained Unreal Labs attribution. |
| Already released in this form | Windows NSIS installers were published for v0.3.0, v0.8.0, and v0.9.0. |
| Functionality and downloads documented | Product features, requirements, and build instructions are in the root README and desktop/BUILDING.md. |
| Privacy and security disclosure | [PRIVACY.md](../PRIVACY.md), [SECURITY.md](../SECURITY.md), and [CODE_SIGNING_POLICY.md](../CODE_SIGNING_POLICY.md). |
| Build provenance | GitHub Actions Desktop acceptance builds and audits the Windows installer from a public commit. Release signing is not connected yet. |
| Roles | The repository owner is the proposed committer, reviewer, and release-signing approver; external changes require review. Signing and repository accounts must use multifactor authentication. |

## Eligibility blocker to disclose

UnrealCode started from the MIT-licensed Unreal Agent repository and extends
its Go harness. Its full upstream history and attribution are retained, but
GitHub currently reports UnrealCode as an independent repository rather than
a GitHub fork. The upstream project publishes Linux/macOS runner archives,
not signed Windows builds. SignPath's published modified-upstream conditions
require a visible fork, signed upstream builds, and a release branch based on
one normally signed upstream. **UnrealCode does not currently meet those
conditions.** A SignPath Foundation exception would need to be granted before
this route could be used; do not imply an application is likely to pass or
restructure the repository merely to disguise its provenance.

The installer also contains third-party open-source runtime components.
An artifact configuration must distinguish project-built UnrealCode files
from included upstream binaries; the project's signing request must not
claim ownership of upstream executables. The source and payload audit and
third-party notices are recorded in WORK_IN_PROGRESS.md and README.md.

If SignPath does not grant an exception, [Microsoft documents](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
a separate free-signing route: distribute an MSIX package through the Microsoft Store,
which re-signs the package after certification. That would require its own
packaging and Store acceptance work. It would not sign the existing GitHub
NSIS installer or issue a personal certificate to the maintainer.

## After approval, before a stable release

1. Configure SignPath's trusted GitHub Actions origin verification and an
   artifact configuration for the NSIS installer and project-built executable.
   Require manual release approval. Keep service credentials in CI secrets.
2. Build `1.0.0` from a reviewed commit in hosted CI. External SignPath
   signing needs a separate candidate path; do not weaken the existing
   `build:stable` fail-closed check for direct certificate signing.
3. Set UnrealCode's expected publisher to the **exact** Common Name of the
   approved certificate. Check the signed app and installer with Windows
   Authenticode, verify timestamp and SHA-256, then test install/update on
   Windows. Publish only the signed installer, blockmap, channel metadata,
   digest, and matching release notes.

See [SignPath Foundation's eligibility rules](https://signpath.org/terms.html)
and [trusted build/origin configuration](https://docs.signpath.io/projects).
