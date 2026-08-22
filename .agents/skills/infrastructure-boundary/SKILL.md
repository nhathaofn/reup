---
name: infrastructure-boundary
description: Protect shared TediaPros infrastructure ownership for FFmpeg and media runtimes, AI runtimes/providers, storage, and queues. Use before a feature directly resolves, configures, starts, or calls shared infrastructure so each dependency has one lifecycle owner and features consume a narrow capability instead of creating private integrations.
---

# Infrastructure Boundary

Give shared infrastructure an owner before multiple features couple themselves to concrete clients, paths, processes, credentials, topics, or deployment details.

## Trigger and preflight

Use this skill when a change touches at least one of these infrastructure surfaces:

- FFmpeg/FFprobe or another shared media executable/runtime;
- AI runtime, model host, provider SDK or provider credential;
- database, object/file storage or shared artifact store;
- queue, broker, stream, scheduler or durable job transport.

Before feature implementation, record an infrastructure note containing:

1. infrastructure surface and existing owner;
2. config, connection/process and lifecycle state that owner controls;
3. narrow operation/port the feature needs;
4. composition point that wires implementation to consumer;
5. timeout, cancellation, health, error and cleanup ownership;
6. direct callers/imports that must reuse or migrate to the boundary.

If no owner exists, choose the smallest cohesive module/package that can own the current lifecycle. Do not defer ownership until a second feature duplicates the integration.

## Ownership rules

The infrastructure owner controls implementation-specific concerns:

- configuration and validated location/endpoint;
- initialization, connection or process lifecycle;
- credentials and secret references;
- health/probe, compatibility and availability state;
- transport-level timeout, bounded retry and cleanup;
- implementation-specific errors mapped to stable categories.

The feature owns its use case, domain validation, processing plan/job payload, business retry/idempotency and result mapping. A shared owner must not become a workflow coordinator or a generic service locator.

Features must not independently:

- locate, download, probe or spawn FFmpeg/FFprobe through feature-private paths;
- instantiate AI provider/model clients or read provider credentials directly;
- create storage/database connections, hardcode buckets/roots or bypass the storage contract;
- create queue clients, hardcode topics/streams or implement private polling/retry loops.

Reuse does not require one universal interface. Keep separate capability-oriented APIs when media execution, AI inference, storage and queueing have different lifecycles or security boundaries.

## TediaPros placement

- Electron Main owns discovery of approved bundled/on-demand device runtimes, verified executable paths and process lifecycle. Renderer/preload expose only feature-oriented typed capabilities; use `electron-boundary` and `external-runtime` when lifecycle changes.
- Server composition owns protected logic/system prompts, AI providers/runtimes, storage implementations and queue transports. Handler, Service and Engine consume narrow ports instead of constructing infrastructure clients.
- A media Engine may build a validated processing request, but the shared media execution boundary owns executable selection/probe and safe process invocation.
- A Service owns durable job semantics; the queue boundary owns transport connection, publish/consume mechanics and delivery diagnostics.
- Repository/storage ports should be owned near their consumer when dependency inversion is real; concrete infrastructure wiring remains at the composition root.

Use `service-engine-boundary` for workflow versus processing responsibility, `package-boundary` for a new structural boundary, `change-impact` when migrating existing callers, and `concurrency-engineering` when queue/process lifecycle introduces concurrent ownership.

## Verification

1. Search feature folders for direct executable paths/spawn calls, AI SDK construction, storage clients and queue connections.
2. Confirm config and lifecycle have one source of truth and no feature-private fallback silently bypasses it.
3. Unit-test feature behavior against the narrow contract; integration-test the real infrastructure owner at its boundary.
4. Verify timeout, unavailable dependency, cancellation and cleanup paths relevant to the change.
5. Use `computer-use` only when the change creates or modifies an actual UI/E2E flow; a small owner/package/backend change without a changed UI path can be accepted by focused unit/integration tests.
