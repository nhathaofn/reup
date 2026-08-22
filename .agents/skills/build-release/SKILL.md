---
name: build-release
description: Build, package, size, inspect, or release Promedia client and server artifacts for Windows and Linux. Use for installer or single-file delivery requests, Electron packaging changes, locale pruning, artifact-size investigations, and release acceptance; do not use for ordinary code verification when no build was requested.
---

# Build and Release

Produce reviewable Promedia artifacts without bundling external runtimes, confusing staging output with deliverables, or claiming targets that were not executed.

## Authorization and targets

- Run builds/packages only when the user explicitly requests them. A request to analyze configuration or make an ordinary code change does not authorize a build.
- When a Promedia build is requested, build and report Windows and Linux separately; do not add macOS.
- Clearly record the OS, architecture, command, artifact, size, launch/acceptance status, and targets that could not be run. Successful cross-compilation does not prove that the binary ran on the target OS.

## Release model

The client artifact contains only the Electron app shell and compiled code. It must not contain FFmpeg/FFprobe, downloaders, Python environments, models, codecs, or optional engines; use `external-runtime` for their lifecycle.

Windows releases one installer `.exe` to users according to the product configuration. Distinguish among:

- installer `.exe`: the artifact users download;
- `win-unpacked`: internal staging/debug output, not a release;
- `builder-debug.yml` and logs: internal evidence, not a release;
- `.blockmap`/update metadata: publish to update infrastructure only when the updater actually uses it; do not present it as a file users need to download.

A single downloaded installer does not mean the Electron application remains a single file after installation. Electron/Chromium must be installed or extracted into an executable, DLLs, and resources. Use a portable target only when the user requests portable behavior and accepts its extraction/runtime semantics; do not describe portable Electron as a binary that never extracts files.

Linux keeps artifacts according to the configured target, such as AppImage or DEB. Do not combine Linux artifacts into the Windows package or create macOS output.

## Client configuration and package size

- The general client release must not hardcode a LAN IP. `VITE_API_URL` and timeout are optional build-time defaults only; users select a local/LAN URL at runtime, and the app stores only an endpoint that completed a successful handshake.
- Do not require users to place an `.env` file beside the client installer/executable. User configuration belongs in Electron user data or the existing storage owner.
- Limit Electron locales in the package to the locales the product currently supports, currently `vi` and `en-US`; do not remove locales required by the real UI.
- Use a minimal package allowlist. Inspect the actual ASAR and packaged resources instead of inferring from `package.json`; development dependencies in the lockfile do not by themselves prove that they entered the artifact.
- Do not remove the Electron executable, Chromium resources, DLLs, or required licenses to make the package appear artificially small. If Electron size still fails the product constraint after removing runtimes/locales/unneeded files, report the framework trade-off instead of promising unrealistic optimization.

## Server artifact and configuration

- Release the server separately for each OS/architecture; do not put the server executable in the client installer.
- Server configuration is runtime input supplied through the environment or an explicitly selected config file. Release secret-free templates/schemas; do not bake a machine-specific LAN IP, credential, database URL, provider key, or model path into the binary.
- Models, AI runtimes, large codecs, and server engines remain outside the Go binary under a configurable data directory/volume. The server package contains only the binary and the operational documentation/templates actually required for deployment.
- When releasing a server for LAN use, bind address, port, allowed origins, authentication, and firewall guidance still belong to `lan-networking`/`client-server-contract`; a passing build does not prove physical-LAN access.

## Pre-build gate

1. Confirm the actual branch/commit and working tree; do not package stale source or a stale artifact by mistake.
2. Run `node verify-base.mjs`, targeted checks, and the appropriate dependency policy/audit before packaging. Do not call a compilation pass a release pass.
3. Verify that packaging configuration includes only required source and excludes external runtimes, models, fixtures/outputs, secrets, and development artifacts.
4. If the build is intended to verify a feature, the feature must pass its corresponding completion gate and architecture audit before the artifact is considered a release candidate.

## Post-build acceptance

1. List real artifacts by target, architecture, hash, and byte size; separate published deliverables from staging/update metadata.
2. Inspect the packaged file list/ASAR to prove that runtimes/models/server binaries were not placed in the client and out-of-scope locales are absent from the deliverable.
3. Install/run the real Windows artifact with `computer-use`; verify startup, Settings/Libraries, and the relevant feature flow. Report `BLOCKED`/`NOT RUN` if UI interaction is not possible.
4. For an on-demand runtime, verify consent, progress/cancel, verification/installation, restart/offline behavior, runtime deletion, and reinstallation using the packaged artifact when relevant to the release scope.
5. Start the server artifact on an OS where it can run, use configuration outside the binary, and verify the real health/contract path. A Linux build on Windows remains build evidence only until it is run on Linux.
6. Report `LAN PHYSICAL PASS` only when a second physical device connects and the server observes the traffic; same-machine traffic or a LAN IP on the same machine must be reported at the correct evidence level.

## Report

Report `verify`, `build`, `package inspection`, `launch/UI`, `server runtime`, `LAN`, and every OS target separately as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. Do not treat a staging directory, an existing file, or an old build artifact as evidence that the current version works.
