# Code signing policy

**Status: signing is not active yet.** The SignPath Foundation application is pending, and current
releases (including 1.0.0) are **unsigned**: Windows SmartScreen warns on first run; verify the
download against the `.sha256` attached to the release. This document states the policy that
**will** apply once the application is approved.

<!-- Maintainer note: once SignPath Foundation approves the project, replace the status paragraph
above with the attribution sentence below (and restore it in the site footer, site/index.html +
site/js/i18n.js):
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).
-->

## What will be signed

Only the Windows executable `pump-sim-win-x64.exe` attached to a
[GitHub release](https://github.com/gmartinu/pump-sim/releases) of this repository. Nothing else
(no npm package, no third-party binary, no build made outside CI) is signed under this policy.
The npm package is not code-signed; it is staged only by the release workflow (`npm stage publish`,
with an npm provenance attestation), never from a local machine, and goes live only after a
maintainer approves the staged version, with 2FA, on npmjs.com.

## How a signed binary will be produced

- Binaries are built **from this repository only, by GitHub Actions only**
  ([`.github/workflows/release.yml`](.github/workflows/release.yml)), on GitHub-hosted runners.
  No binary built on a developer machine is ever submitted for signing.
- A release starts when a maintainer pushes a tag `v<version>` that matches `version` in
  `package.json` (the workflow checks it and stops otherwise).
- The workflow runs the full check suite (`npm run ci`: typecheck, lint, tests), builds the
  executable with `npm run build:sea:win` (official `node.exe` from nodejs.org, verified against its
  published SHA-256, with the application bundle injected), uploads it as a workflow artifact and
  submits that artifact to SignPath. SignPath verifies that the artifact comes from this repository's
  workflow before signing.
- The signed file, and its SHA-256, are attached to the GitHub release of that tag.

## Team roles

| Role | Who | What they can do |
| --- | --- | --- |
| Author / committer | [Gabriel Martinusso](https://github.com/gmartinu) | Writes and merges code |
| Reviewer | [Gabriel Martinusso](https://github.com/gmartinu) | Reviews every change from outside contributors before it is merged |
| Approver | [Gabriel Martinusso](https://github.com/gmartinu) | Approves each signing request in SignPath (manual approval, one per release) |
| Release trigger | Repository maintainers with write access (today only Gabriel Martinusso) | Push a `v*` tag, which starts the release workflow |

Contributions from people outside the team are accepted only through pull requests reviewed by a
reviewer above. All team members use multi-factor authentication on GitHub and on SignPath.

## Privacy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it. It listens on the ports the user
configures (the simulated console, by default on `0.0.0.0:2001`; the control API and UI on loopback
only) and connects only to the addresses given to `pump-sim diff`. It has no telemetry and no
update check.

## SignPath project setup (for the maintainer)

- Repository variables: `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
  `SIGNPATH_SIGNING_POLICY_SLUG`; secret: `SIGNPATH_API_TOKEN` (a SignPath CI user with the
  submitter role only).
- Trusted build system: GitHub.com, linked to this repository.
- Artifact configuration: the workflow artifact is a zip holding one PE file,
  `<zip-file><pe-file path="pump-sim-win-x64.exe"><authenticode-sign/></pe-file></zip-file>`.
- Signing policy: release signing with manual approval by the approver.
