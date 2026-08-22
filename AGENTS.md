# TediaPros Project Instructions

## Scope

These rules apply to the entire repository:

- `server/`: Go backend that owns protected logic, system prompts, provider orchestration, and versioned API contracts.
- Repository root (`src/`, `package.json`): Electron + Vite + React + TypeScript desktop client.

## Build Rules

- Do not run builds automatically unless the user explicitly requests them.
- Do not automatically run `go build`, `npm run build`, `npm run dist`, `electron-builder`, or equivalent packaging commands during normal coding work.
- When the user requests a build, build and verify only for Windows.
- Do not build or package for Linux or macOS.
- When reporting build results, clearly state which targets were run and which targets were not run.
- When a request involves a build, package, installer, release artifact, package size, or a release file, use the `build-release` skill before running packaging commands.

## Working With Unclear Requests

- When an unclear point could change behavior, the interface, data, or the scope of the change, ask for clarification before implementing the part that depends on it; do not choose an important direction on your own and treat it as the user's requirement.
- Questions must present short, easy-to-select options and always include a free-form answer field in case none of the options is suitable.
- Asking for clarification must not cancel or end the task in progress: preserve the context, existing changes, and any independent work that can continue; after the user responds, resume from the waiting point.
- For small details that do not materially affect the result, you may choose a reasonable default, state the assumption, and continue.

## Platform Compatibility

TediaPros targets Windows:

- Use Windows-compatible Go, Node.js, and Electron APIs and the appropriate path APIs.
- Do not add Linux or macOS build, packaging, or product behavior to the default workflow.
- Isolate unavoidable Windows-specific behavior in a small, clearly named module.
- Do not claim Linux or macOS support from cross-platform source alone.

## Architecture Rules

- Before adding behavior, read the current structure and look for abstractions that can be reused.
- Use the smallest organizational unit that still keeps the code clear: existing code → function → file/module → package.
- Service and Engine are responsibility roles within a file/module/package, not abstraction levels above a package, and they do not have to be separate classes/structs.
- Do not create a Service, Engine, Repository, Manager, Handler, Provider, Adapter, or package merely to make the code look "standard."
- Each module/package should contain one group of responsibilities and have one primary reason to change.
- Separate parts with different responsibilities, but connect them through a clear API or dependency direction.
- Do not combine UI, application workflow, infrastructure, storage, or processing algorithms in one large module.
- Do not create `utils`, `common`, or `misc` as dumping grounds for code without a clear boundary.
- Keep the public API minimal; prefer `internal` when code is used only within the project.
- Do not create abstractions for future requirements without a concrete use case.
- Every capability/feature with an independent use case must have a clear boundary, input/output, and entrypoint so it can be invoked independently; pipelines or workflows must be composed from independent capabilities/stages rather than locking all behavior into a single flow.
- Pipeline stages must limit hidden state and unnecessary coupling so they can be reused, replaced, reordered, or tested independently when the contract permits.
- When creating a new feature or behavior, design around input, context, and contract instead of hardcoding it to one case, fixture, file, account, provider, model, or specific workflow. Do not let a single default/sample become an implicit limit of the implementation.
- Check valid cases and relevant boundaries, including changing inputs, empty/error states, retry, or reordered execution when the capability supports them. If generalization is not technically feasible, clearly document the reason, limited scope, required invariants, and fail-closed behavior; the boundary must still be clear enough to replace or extend later.

## Default UI Style

- The client UI defaults to Warm Minimal / Beige Minimalism: minimal, neutral, calm, friendly, and slightly handcrafted; it must not feel overly technological.
- Use the palette background `#F5F1E8`, surface `#FBF9F4`, text `#181716`, secondary `#716D66`, border `#DED9CF`, and primary `#1D1C1A`. Add status colors only when needed to communicate a real state.
- Favor generous whitespace, separation with thin borders, lightly rounded cards/panels around 8–12px, and avoid strong shadows.
- The entire UI uses one multilingual system sans-serif stack, prioritizing Noto Sans and Segoe UI; do not use handwritten fonts or fonts without reliable Vietnamese glyph support for the logo, headings, empty states, or product content.
- Primary buttons use a black background with white text, icons use thin outlines, images have low saturation, and animations should be subtle, slow, and restrained.

## Client Styling Strategy

- The client uses React TSX and semantic CSS; do not introduce Tailwind or another styling framework without an explicit product requirement.
- Keep app-wide tokens and composition in `src/renderer/src/styles.css` while colocating substantial feature/page styles with the owning capability when a split improves ownership.
- Use short semantic class names whose responsibility is clear; avoid long selector chains and one-off utility layers.
- Do not use inline styles or create a separate design-system/utility layer without a concrete use case.

## Project Skill Routing

The agent must route skills automatically from intent, scope, boundaries, and risk for every repository-related prompt; users do not need to name a skill. Before the main action, compare the prompt against the `description` and triggers of all available skills, select the smallest set that fully covers the request, read every selected `SKILL.md` in full, and reevaluate routing if the scope changes during the work.

Every project skill must keep `policy.allow_implicit_invocation: true` in `agents/openai.yaml`. Switch a skill to explicit-only only when the user explicitly requests it; do not wait for the user to invoke `$skill-name` before applying an appropriate skill.

`AGENTS.md` and `.agents/skills/` must be committed together as one contract. Do not reference a project skill in `AGENTS.md` unless the corresponding skill folder exists in the same Git tree with `SKILL.md`, `agents/openai.yaml`, and a valid implicit-invocation policy.

When implementing a new feature or non-trivial behavior change:

0. Always use `feature-workflow` before coding to perform preflight, select specialized skills, and set the feature completion gate.
1. Use `change-impact` before changing shared behavior, signatures, APIs, IPC, schemas, configuration, public exports, or data flow across multiple boundaries; before completion, review the impact map and search for stale references.
2. Use `feature-placement` when a change may add or move a function, file/module, package, type, Service, or Engine.
3. Use `package-boundary` if the feature creates, splits, or expands a Go package or TypeScript module/folder boundary.
4. Use `service-engine-boundary` if the feature has an application workflow that combines a repository/storage/provider with a processing pipeline.
5. Use `infrastructure-boundary` before a feature directly resolves, configures, starts, or invokes FFmpeg/media runtimes, AI runtimes/providers, storage, or shared queues.
6. Use `algorithm-engineering` before implementing or changing a non-trivial algorithm, compute-heavy processing, optimization/search, a media/ML/parsing kernel, a performance-sensitive data structure, or processing with explicit correctness, numerical behavior, determinism, complexity, or resource requirements.
7. Use `concurrency-engineering` before adding or changing goroutines, channels, locks, atomics, worker pools, task queues, parallel stages, shared mutable state, worker threads, message ports, or cancellation/ordering across concurrent work.
8. Use `client-server-contract` when adding or changing endpoints, payloads, statuses/errors, auth/CORS, timeouts, or how the client calls the server.
9. Use `electron-boundary` when changing IPC, preload APIs, filesystem access, processes, dialogs, credentials, notifications, window behavior, or native capabilities.
10. Use `client-ui` when implementing or changing UI, layout, interaction, or UX under `src/renderer/`.
11. Use `lan-networking` when changing listen addresses, LAN IP/hostname handling, CORS for a local network, firewall/discovery behavior, or when concluding that another device can access TediaPros.
12. Use `external-runtime` when changing the lifecycle of an engine or runtime. TediaPros currently preserves its existing bundled/on-demand behavior per runtime; do not relocate a runtime merely because the skill is selected.
13. Use `build-release` when building/packaging/releasing, changing packaging configuration, optimizing size, or determining which artifact is released.
14. After coding, use `architecture-audit` for a non-trivial feature/refactor to check abstractions, dependencies, boundaries, and any overlooked impact.

For small changes that clearly belong to an existing owner, use only the skills that are genuinely relevant. Do not use the full skill set for formatting, documentation-only edits, or an isolated literal change.

### Mandatory Gate Before Editing Code

- Before the first edit of a feature, the agent must read `feature-workflow` and every selected specialized skill in full; relying only on a skill's name or description is not allowed.
- The agent must briefly announce which skills are being used and why, then record a placement/impact note when the relevant skill requires it.
- Do not start coding while a skill triggered by an API, IPC, UI, config, schema, package/module boundary, processing workflow, algorithm constraint, or non-trivial concurrent execution/shared state has not yet been loaded.
- Before reporting completion, search for stale references, check related callers/consumers, and run appropriate verification. `computer-use` is mandatory only when the change creates or modifies a UI/E2E flow; a small function, package, or backend change that does not alter the UI path may be completed with appropriate unit/integration/contract tests.

## Naming and File Conventions

- Variable, function, type, interface, package, and export names in code must be in English.
- File and folder names must be short, clear, easy to find, and extensible.
- Names must describe a capability or responsibility, not a temporary state such as `helper`, `misc`, `new`, or `temp`.
- Go package names use lowercase; do not create a package for only one small file.
- Keep clear boundaries among Electron main, preload, renderer, and client UI components.
- Do not create a new file/component when the responsibility still clearly belongs in an existing file/module.

## Language

- Code comments must be written in accented Vietnamese and added only when they explain a decision or non-obvious behavior.
- Do not use comments to repeat a function name or statement.
- User-facing UI text, labels, validation messages, and error messages must come from the i18n system; do not hardcode displayed text in feature logic or markup.
- The current product locale is Vietnamese (`vi`) only. Every new or touched user-facing string must update its Vietnamese locale dictionary.
- Keep each capability's locale dictionary in its own file when the capability is large enough to own one; do not put translation dictionaries inside page markup.
- Technical logs may use English when needed for search and operations.
- Do not mix technical English into the UI without a product reason.

## i18n and Language Settings

- The initial locale set contains only Vietnamese (`vi`); do not add a language selector while no second locale exists.
- The i18n system must use deterministic `vi` fallback and must never expose raw i18n keys in the UI.
- When a second locale is explicitly requested later, keep it in a separate locale file, add locale persistence, and add the language selector in the same feature change.
- New screens and flows are incomplete while they contain hardcoded user-facing text, placeholder text, or missing Vietnamese keys.

## Client and Server

- The API contract between `server/` and the root Electron client must be clear, stable, versioned, and configurable.
- Do not hardcode the server address in multiple places; use environment/configuration.
- The client must not access the server database or infrastructure directly.
- TediaPros is fail-closed: the application shell and every feature require a successful server handshake before use.
- The server owns protected business logic, system prompts, provider calls, job planning, and backend infrastructure. Electron Main owns local files, packaged runtime/process lifecycle, and execution of typed media plans; the renderer handles only UI state and calls APIs through a boundary.
- Do not expose a generic prompt proxy. Each protected operation must have a named request/response contract so the client cannot supply or reconstruct the server's system prompt.
- Electron main/preload/renderer parts must communicate through clear boundaries; do not enable unnecessary Node.js privileges in the renderer.

## Infrastructure Boundary

- FFmpeg/FFprobe and media runtimes, AI runtimes/providers, storage/database clients, and queues/brokers must have a clear lifecycle owner before the first feature integrates them; do not wait until multiple features invoke them separately before extracting ownership.
- The owner holds the source of truth for configuration, executable/endpoint, credential references, connection/process lifecycle, health/probes, transport timeout/retry, and cleanup. The feature owns the use case, domain validation, processing plan/job payload, business retry/idempotency, and result mapping.
- A feature must not privately resolve/download/probe/spawn FFmpeg from its own path, independently create an AI SDK/model client or read credentials, independently open a storage/database connection, or hardcode queue topics/streams or polling loops.
- Electron Main owns device runtime and process lifecycle. Server composition owns AI providers/runtimes, storage implementations, and queue transport. Renderers, handlers, Services, and Engines consume only narrow capabilities/ports appropriate to their boundary.
- A shared owner must not become a service locator or a `Manager` that combines FFmpeg, AI, storage, and queues. Keep separate APIs and lifecycles for infrastructure surfaces with different responsibilities.
- The composition root wires concrete infrastructure to consumers; feature packages/modules must not import deployment details. When replacing a shared owner or contract, use `change-impact` to review every old caller.

## Media and AI Processing Placement

- By default, non-AI media processing runs on the device: probe, thumbnail, waveform, cut/join, crop/resize, transcode/compress, audio, subtitles, watermark, and conventional scene detection.
- By default, heavy AI/models, credentialed providers, durable jobs, shared storage, and batches that must continue after the client closes run on the server.
- Hybrid flows must have the server return a structured transcript, timestamps, regions, timeline, or processing plan; the client applies the result to the original media through a local engine whenever possible.
- Do not upload original media to the server solely to perform a local operation. When AI requires content, send only the minimum audio/frame/chunk/proxy under a contract with clear consent, size limits, retention, and cleanup.
- Every feature depends on the mandatory TediaPros server session. After authorization/planning, Electron Main still executes local media work and owns local progress, cancellation, and output files.
- Conventional rendering/transcoding of user-owned original media always stays in Electron Main. Server-side media processing is limited to data already owned by the server or the minimum audio/frame/chunk/proxy required by a named AI contract; it must not become an alternate upload-and-render backend.

## LAN and Libraries/Engines

- LAN configuration must use an environment value or a URL entered by the user; do not hardcode the current IP, scan the subnet automatically, or modify the firewall automatically without an explicit request.
- Store a server URL entered by the user only after a real TediaPros handshake responds successfully. Distinguish loopback checks, a LAN IP on the same machine, and a separate physical device when reporting results.
- Preserve the current project packaging and download behavior for FFmpeg/FFprobe, fonts, Python helpers, and feature engines. Do not move an existing bundled runtime outside the package or bundle a currently on-demand engine without an explicit request.
- Provider credentials, protected prompts, large server models, AI runtimes, and server engines remain server-owned and must not be embedded in the Electron package. Server-side runtime paths are configurable and never returned to the client.
- The engine download button belongs in the feature that needs the engine and appears only when the runtime is missing or invalid. It must disappear after a successful download and verification; if the user deletes or damages the runtime, the button must reappear on the next check.
- All runtime metadata must come dynamically from a validated catalog; skills, UI, and shared lifecycle code must not hardcode feature/engine names, versions, sizes, URLs, checksums, install paths, or platform-specific filenames.
- The client must have a Library route near Settings showing verified status and allowing runtimes to be installed/repaired through the same lifecycle as the feature CTA. A feature must check when opened, display complete version/size/processing-location/privacy/phase information, open the feature UI automatically after installation, and recheck immediately before execution.
- Do not download or execute an artifact without a version, an allowed HTTPS source, SHA-256, size, license, and explicit platform/architecture.

## Real Data and Testing

- Features must be tested with real data or a real data source wherever feasible: a running server, database, file, API, or actual payload.
- Do not use mockup data in the UI or simplistic fake data to conclude that a feature works correctly.
- Do not hardcode business data, user data, API payloads, connection addresses, or frequently changing configuration in code.
- Data that can change must be supplied through environment, config, database, request input, or a clearly structured fixture/seed file.
- Test fixtures and seeds must model the actual data format, be managed separately from processing logic, and be easy to replace.
- Do not put secrets, tokens, personal data, or sensitive production data in source code, public fixtures, or logs.
- When real data cannot be used for security or environmental reasons, use anonymized data that preserves the required structure and characteristics, and clearly state the testing limitation.
- Tests must verify the real data path across boundaries, not only a single function with values created inline in the test.

## UI/E2E Testing Through the Interface

- `computer-use` is mandatory for changes that create or modify a user/E2E flow: a page, interaction, client workflow, IPC/native capability triggered from the UI, user-visible client-server connection, or packaged-app behavior.
- For flows where it is mandatory, exercise the real product path: open the screen, click/type, trigger the function, wait for the result, and check relevant loading/validation/error/empty/success states. Report `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` based on real evidence.
- A small function, module/package, algorithm core, config loader, repository, handler, or backend change that does not create/change a UI/E2E flow does not require `computer-use`; appropriate unit, integration, API, or contract tests may be the primary acceptance evidence.
- Do not create fake UI or expand scope merely to provide a click-through path for an independent backend/package change. In reports that include a computer-use field, write `NOT REQUIRED` with a short reason.
- When a backend/API/IPC behavior change is used by a real UI flow, verify the integration/contract first and run `computer-use` for that affected flow.
- `computer-use` provides the required Windows UI evidence for TediaPros flows.

## Verifying Changes

- Do not build unless requested, as stated above.
- When verification does not require a build, prefer narrow tests, type checking, linting, or static checks.
- After each feature or behavior change, run `node verify-base.mjs` at the repository root by default to verify server and client together. Individual `server` or `client` stages may be run for diagnosis, but they do not replace the full-base gate before completion.
- When a change creates or modifies a UI/E2E flow, start the required server/client and verify the affected flow with `computer-use`; do not disable unrelated routes, capabilities, or components merely to make the new flow run.
- For a small function/package/backend change that does not alter UI/E2E, run unit/integration/API/contract tests appropriate to the boundary and do not treat the absence of `computer-use` as missing evidence.
- When the user requests a build, run and report the Windows target only; state that Linux and macOS are outside product scope and were not run.
- Do not fix or clean up code outside the feature scope unless required for correctness, maintainability, or the direct request.
