---
name: feature-workflow
description: Automatically plan and deliver any new TediaPros feature or non-trivial behavior change from pre-edit skill routing through implementation and verification. Use whenever a prompt adds user-visible behavior, a screen, endpoint, workflow, integration, processing capability, IPC, schema/config change, or cross-file refactor, even when the user does not name a skill. Do not use for review-only, documentation-only, formatting, or an isolated literal correction.
---

# Feature Workflow

This is the mandatory gate before coding a TediaPros feature. This skill coordinates the process; specialized rules remain the responsibility of the corresponding skills.

## Preflight Before the First Edit

1. Read `AGENTS.md`, the directory tree around the feature, the current owner, callers/consumers, and relevant tests.
2. Classify the intent, boundaries, and risks using the triggers below; select specialized skills and read every selected `SKILL.md` in full before modifying files. Do not wait for the user to name a skill.
3. Briefly announce which skills are being used and why. If placement or impact is non-trivial, record the note required by the corresponding skill.
4. Start editing only after the source of truth, owner, and dependency direction are clear. If an unclear point changes behavior or scope, ask the user and continue independent work while waiting.

## Specialized Routing

- Shared behavior, signatures, exports, config, API/IPC/schema, or data flow across multiple boundaries: `change-impact`.
- Adding or moving a function, type, file/module/package, Service, or Engine: `feature-placement`.
- Splitting/merging folders or packages, an unclear public API, or a dependency cycle: `package-boundary`.
- An application workflow coordinating storage/providers with a media, ML, parsing, or processing pipeline: `service-engine-boundary`.
- A feature that directly resolves/configures/starts/invokes FFmpeg, an AI runtime/provider, storage, or a shared queue: `infrastructure-boundary`.
- A non-trivial algorithm, heavy computation, optimization/search, a media/ML/parsing kernel, a performance-sensitive data structure, or explicit correctness/numerical/determinism/resource requirements: `algorithm-engineering`.
- Goroutines, channels, locks, atomics, worker pools, task queues, parallel stages, shared mutable state, worker threads, message ports, or cancellation/ordering across concurrent work: `concurrency-engineering`.
- Endpoints, payloads, HTTP statuses/errors, CORS/auth, timeouts, or client API consumption: `client-server-contract`.
- Electron main/preload/renderer, IPC, filesystem, processes, dialogs, credentials, notifications, or window/native capabilities: `electron-boundary`.
- Renderer UI, layout, interaction, accessibility, i18n, or UX: `client-ui`.
- Server binding, LAN IP, CORS for a local network, firewall, discovery, or evidence of access from another device: `lan-networking`.
- Changes to bundled, on-demand, or server-managed library/binary/model/codec/engine lifecycle: `external-runtime`.
- Builds, packages, installers, release artifacts, package size, Electron locales, or a single-file release request: `build-release`.

Select only skills with actual triggers. A small feature with a clear owner does not require the entire skill set.

## Implementation gate

- Use the smallest owner that preserves cohesion; do not create an abstraction or package merely to standardize form.
- Update the source of truth first, followed by affected callers, consumers, config, fixtures, tests, and documentation.
- Keep code, UI, application workflow, infrastructure, and processing at the correct boundaries; keep the public API minimal.
- Before a feature touches FFmpeg, an AI runtime, storage, or a queue, identify the infrastructure owner and capability contract; the feature must not create a private path/client/connection/topic for direct access.
- A triggered algorithm must have an algorithm note and an independent oracle before implementation; do not use benchmarks in place of correctness tests.
- Triggered concurrency must have a concurrency note covering ownership, synchronization, bounds, cancellation, lifecycle, and ordering before implementation.
- New UI must follow `client-ui`, include complete Vietnamese (`vi`) i18n keys, avoid hardcoded text, and keep content within the app shell.
- Every feature is gated by the mandatory TediaPros server handshake. A media feature records `server-plan/device-execution`: protected logic and prompts run on the server, while Electron Main applies typed plans to original local media and transmits only the minimum data needed for a named analysis contract.

## Completion gate

1. Search again for relevant old identifiers, paths, literals, selectors, config keys, and contracts.
2. Review the impact map and classify every location as updated, intentionally compatible, or not completed with a reason.
3. Run `node verify-base.mjs` to verify the entire server/client base, then run the required specialized tests, type checks, lint, or static checks; do not build unless the user requested it.
4. Reread every changed file, remove redundant imports/branches/references, and confirm that names, control flow, and responsibilities remain understandable without guesswork.
5. Use `architecture-audit` for a non-trivial feature/refactor and fix regressions within the change scope.
6. When a change creates or modifies a UI/E2E flow, start the current base and use `computer-use` to verify the product path and relevant states. A small function, package, or backend change that does not alter UI/E2E may be completed with appropriate unit/integration/contract tests and `computer-use: NOT REQUIRED` with a reason.
7. If the user requests a build/package/release, use `build-release` to inspect the real artifact; compilation or a staging directory is insufficient to conclude that a release meets requirements.
