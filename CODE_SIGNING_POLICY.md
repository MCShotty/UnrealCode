# Code signing policy

**Status: proposed.** UnrealCode's current 1.0 preview installer is unsigned.
No SignPath Foundation subscription or signing policy has been approved for this
project, and no release should be described as SignPath-signed until its actual
Authenticode signature has been verified.

The project is seeking the open-source route described as **“Free code signing
provided by SignPath.io, certificate by SignPath Foundation.”** If accepted,
Windows will display **SignPath Foundation** as the certificate publisher, not
the repository owner's personal name. SignPath's eligibility and signing rules
are published in its [open-source terms](https://signpath.org/terms.html).

## Project and responsibilities

- Source: the public [MCShotty/UnrealCode repository](https://github.com/MCShotty/UnrealCode).
- Maintainer, committer, reviewer, and proposed release-signing approver:
  [MCShotty](https://github.com/MCShotty), the repository owner. Contributions
  from people without direct write access require maintainer review before merge.
- Only the maintainer may authorize a release-signing request. Repository and
  signing-service accounts used for release work must have multifactor
  authentication enabled.
- The application privacy disclosure is in [PRIVACY.md](PRIVACY.md); security
  reports use [SECURITY.md](SECURITY.md).

## Proposed release procedure

1. Build from a reviewed, publicly reachable Git commit in hosted CI. The
   current desktop workflow runs Windows and Go checks, packages the app, and
   audits credentials and redistribution notices. It does **not** sign yet.
2. If SignPath approves the project, configure its trusted-build origin checks,
   artifact rules, and a release policy requiring manual maintainer approval.
   Keep signing credentials and service tokens outside the repository.
3. Submit only the installer and project-built executables covered by the
   approved artifact configuration. Do not claim upstream binaries as the
   project's own signed output. Verify product/version metadata and the exact
   source revision before approval.
4. Verify Authenticode signatures, publisher identity, timestamps, installer
   digest, update metadata, and installation on Windows before publishing a
   `v1.0.0` tag or GitHub release assets. Publish the signed artifact's digest.

The desktop includes the MIT-licensed Unreal Agent harness and builds an
extended Go backend from bundled source. This upstream-derived arrangement
currently fails SignPath's published modified-upstream conditions and would
require an exception before this proposed route could be used. The
project's attribution and dependency inventory are in [README.md](README.md)
and [desktop/OPTIONAL_RUNTIME_INVENTORY.md](desktop/OPTIONAL_RUNTIME_INVENTORY.md).
The [application packet](desktop/SIGNPATH_APPLICATION.md) records the evidence
and eligibility blocker for the project owner to review.
