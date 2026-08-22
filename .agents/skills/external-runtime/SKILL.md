---
name: external-runtime
description: Design, implement, or change TediaPros lifecycle management for libraries, binaries, models, codecs, or processing engines. Use when changing a runtime's bundled, install-on-demand, or server-managed lifecycle, its catalog, integrity checks, installation, repair, or availability gate.
---

# External Runtime

Preserve the approved lifecycle of each TediaPros runtime and give every runtime one clear owner.

## Inspect before deciding

Read `electron-builder.yml`, `engines-manifest.json`, `src/main/deps.ts`, `src/main/runtimeSetup.ts`, and the feature's current resolver before editing. Record:

1. runtime ID and capability;
2. current lifecycle: `bundled-client`, `on-demand-client`, or `server-managed`;
3. lifecycle owner and source of truth;
4. platform/architecture, source, license, integrity, compatibility probe, and cleanup behavior;
5. every feature and package rule that consumes it.

Do not move an existing runtime to another lifecycle merely to apply a general preference. Changing lifecycle is a product/package decision and requires an explicit user request plus `change-impact` and `build-release`.

## Current product model

- The Windows Electron package keeps the FFmpeg/FFprobe pair, fonts, and packaged media helper currently declared by `electron-builder.yml`.
- Existing feature engines and download tools that are already installed or refreshed on demand keep that behavior and remain owned by Electron Main under TediaPros user data.
- AI providers, protected prompts, server models, and server processing engines are server-owned. They do not enter the Electron package or client runtime catalog, and server paths/credentials never appear in client responses.
- Do not bundle the Go server into the Electron installer.

The runtime catalog or resolver is the source of truth for facts used by more than one consumer. Feature UI must consume typed status derived from that owner rather than duplicate version, URL, checksum, or path literals.

## Bundled-client contract

For a bundled runtime:

- package only the declared Windows files and licenses;
- keep executable resolution in Electron Main and validate the packaged path/pair before use;
- exclude credentials, models, server binaries, test artifacts, caches, and local sessions;
- update package inspection when the declared file set changes;
- use `build-release` before claiming the installed artifact contains and runs the runtime.

Source checkout or staging-directory presence is not packaged-artifact evidence.

## On-demand-client contract

For an on-demand runtime, install under an application-owned TediaPros user-data directory using Windows path APIs. The filesystem plus validation marker is the source of truth:

- `missing`: required files or marker are absent;
- `invalid`: version, hash, file set, or compatibility probe fails;
- `downloading`: one bounded operation owns progress and cancellation;
- `ready`: integrity and compatibility checks pass;
- `error`: retry remains visible with an actionable Vietnamese i18n message.

Require an allowlisted HTTPS source, resolved version, byte size, SHA-256, license/source evidence, archive safety, and a compatibility probe. Download to a temporary file, verify before extraction, prevent traversal/links, install atomically, write the marker last, and clean partial state on failure or cancellation.

Renderer receives only feature-oriented status/progress. Preload exposes narrow typed methods. Electron Main owns URLs, filesystem paths, download, integrity, extraction, permissions, probe, removal, and process launch.

## Server-managed contract

Server runtimes and models live under server configuration/data directories, not the Go binary. Server composition owns their configuration, credentials, health, process/connection lifecycle, timeout, and cleanup. The client receives only capability availability and operation results.

## Verification

- Recheck every consumer and package exclusion/inclusion rule after a lifecycle change.
- Test missing, invalid, unavailable, successful validation, cancellation, restart, and deletion paths relevant to the selected lifecycle.
- Use real approved artifacts or structurally identical anonymized fixtures; label fixture evidence.
- Use `computer-use` for changed Windows UI flows.
- Never claim package contents without inspecting the newly built Windows artifact, and do not build unless explicitly requested.
