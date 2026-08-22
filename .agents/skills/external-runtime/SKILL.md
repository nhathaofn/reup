---
name: external-runtime
description: Design, implement, or change Promedia lifecycle management for external libraries, binaries, models, codecs, or processing engines that must stay outside the Electron client bundle or server binary. Use for on-demand device runtimes and separately managed server runtimes.
---

# External Runtime

Keep large or optional engines outside the client build while giving each feature a predictable install-on-demand experience.

## Choose the Runtime Owner

Before adding a catalog entry or downloader, classify the runtime according to the capability's processing placement:

- `device`: non-AI media engines and local-file processing belong to the client by default. The runtime is installed on demand under Electron user data and invoked through Electron Main.
- `server`: heavy AI/models, provider runtimes, background batches, or engines that process server data belong on the server machine. They remain outside the Go binary and client catalog, under the server's configured data directory/volume.
- `hybrid`: the server runtime analyzes only the minimum data; the device runtime applies results to the original media whenever possible.

Do not bundle the same runtime into both client and server by default. If a capability genuinely supports multiple execution backends, the catalog/contract must represent runtime selection explicitly and every backend must have its own lifecycle owner. Use `service-engine-boundary` to decide placement before designing the lifecycle.

## Core invariant

External runtimes must not live under client source, `out`, ASAR, packaged resources, or another directory included by `electron-builder`. Install them under an application-owned user-data directory, for example `<userData>/runtimes/<runtime-id>/<version>`, using Electron/Node path APIs on Windows and Linux.

Do not add a fake runtime declaration, placeholder download, or generic UI card before a real feature supplies a reviewable artifact source, license, integrity mechanism, and compatibility probe.

Server runtimes and models must not be linked, embedded, or copied into the server executable merely to create one large binary. Server configuration owns the root directory/volume, version, and required credentials; secrets must not appear in markers, public catalogs, or release artifacts. The client must not receive server filesystem paths, model paths, or provider credentials.

## Dynamic runtime catalog

Every real runtime must be declared in one validated data catalog. Feature UI, the Libraries page, preload, and main-process lifecycle code must read this catalog or typed status derived from it; they must not duplicate runtime facts.

The skill and generic UI/lifecycle code must never hardcode a particular feature name, engine name, version, byte size, artifact URL, checksum, install path, or platform filename. Those values belong to the catalog or to metadata resolved from an allowlisted upstream source at check/install time.

Each catalog entry must describe:

- a stable runtime ID and localized feature-facing name, description, privacy statement, and processing location;
- feature/capability requirements and technical component names as metadata, not UI constants;
- supported `win32`/`linux` architecture selectors;
- an allowlisted HTTPS owner/source and a deterministic release-channel/artifact selection policy;
- integrity metadata or a checksum artifact that resolves the selected artifact's SHA-256;
- archive type, declared entry files, license/source URL, and compatibility probe;
- dynamically resolved version, byte size, artifact URL, and checksum for the concrete install attempt.

Validate catalog schema and all upstream metadata before use. Fail closed when no artifact matches the declared platform/policy. Never put secrets or short-lived signed production URLs in source. Persist the resolved version, artifact identity, size, checksum, executable hashes, and install time in the installed marker so an installed runtime remains verifiable offline.

The Electron catalog is the source of truth only for device runtimes. If the server needs a runtime catalog/registry, keep a separate source of truth on the server because its platform, access permissions, update policy, and storage lifecycle differ from the client; do not use the client catalog as server deployment configuration.

## State model and one-time prompt

The filesystem plus integrity validation is the source of truth, not a permanent “asked” boolean.

- `missing`: artifact or install marker is absent; show the feature-local download button.
- `invalid`: files, version, checksum, executable probe, or marker do not match; show repair/download again.
- `downloading`: disable duplicate actions and show progress/cancel state.
- `ready`: validation passes; hide the download button and enable the feature.
- `error`: keep retry visible with an actionable i18n message.

Ask only when the user enters or invokes the feature that needs the runtime. After a successful install, do not ask again. Re-check availability when the screen opens and immediately before use, so deleting or corrupting the runtime makes the button reappear automatically. A catalog refresh or newer upstream release alone must not force a working runtime prompt to reappear unless product update policy explicitly requires it.

## Feature gate and Libraries page

Every feature-local runtime gate follows the same product flow:

1. Check the declared requirement when the feature screen opens; do not check every runtime at app startup.
2. When missing/invalid, replace only the dependent feature area with a consent card whose main title is the localized feature name, not a bare technical library name.
3. Show resolved version, download size, processing location, privacy statement, license, and technical components before consent.
4. Show distinct resolving, downloading, verifying, extracting, installing, done, cancelled, and error states. Expose real byte progress when available and keep cancel/retry accessible.
5. On successful validation, remove the gate and reveal the actual feature UI automatically without requiring a restart or second click.
6. Call the narrow status API again immediately before launching the processing action. If validation fails, return to the gate and do not launch the runtime.

The desktop shell must also provide one Libraries route adjacent to Settings. It lists catalog entries and current filesystem-validated state, and allows the same install/repair operation there. This is a second entry point into the shared lifecycle, not a separate runtime registry or a copy of feature constants. Installed entries remain visible; missing/invalid entries expose install/repair when a verified source is available.

## Ownership and boundary

- Renderer owns feature-local and Libraries-page states and i18n UI; it never receives arbitrary filesystem or process access, source URLs, or install paths.
- Preload exposes narrow typed methods such as status, install, cancel, and remove for a declared runtime ID. Never expose raw IPC or arbitrary URLs/paths.
- Electron main owns the runtime directory, download, integrity verification, extraction, executable permissions, probe, cleanup, and process launch.
- Add the smallest shared runtime manager only when the first real engine exists. The catalog owns declarations, the feature owns its requirement and CTA, and the manager owns lifecycle mechanics, not feature workflow.
- Use `electron-boundary`, `client-ui`, `change-impact`, and `concurrency-engineering` when implementing the actual asynchronous download path. Artifact provenance and integrity are part of this lifecycle: require an allowlisted owner/source, deterministic release metadata, SHA-256 verification, archive safety checks, license evidence, and a compatibility probe before installation. Use `build-release` for packaged-artifact inspection. Do not reference an optional skill that is not present in this checkout.

## Safe installation

1. Check supported OS/architecture, available disk space, and the existing validated install.
2. Obtain explicit user consent from the feature-local button and show size/license information.
3. Download to a unique temporary file with timeout, cancellation, bounded concurrency, and size limits.
4. Verify SHA-256 before extraction. Reject redirects or final hosts outside the allowlist.
5. Extract with path-traversal and symlink protections into a temporary directory.
6. Validate the declared entry path/probe, then atomically rename into the versioned runtime directory.
7. Write the installed marker last. Remove partial files on failure/cancel and keep the previous valid version until replacement succeeds.

Never execute an unverified artifact. Do not use package-manager install scripts as an implicit runtime downloader.

## Verification

- Confirm the packaged file allowlist still excludes runtime directories; do not claim package-size success without inspecting an actual requested build artifact.
- Test missing, download consent, progress/cancel, checksum failure, successful validation, app restart, offline use of an installed runtime, manual deletion, and re-download.
- Use a real approved artifact or an anonymized internal fixture with the same archive/checksum structure; label fixture-only evidence clearly.
- Verify the complete Windows UI path with `computer-use`. Verify Linux-specific paths separately when behavior differs, and report targets not run.
- For server runtimes, verify that the server binary/package does not contain the model/engine, configuration contains no secrets, the runtime root is configurable, and the server fails closed when the runtime is missing or has the wrong version.
