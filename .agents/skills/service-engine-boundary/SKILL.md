---
name: service-engine-boundary
description: Separate TediaPros application workflow responsibilities from non-trivial processing responsibilities. Use when behavior coordinates repositories, storage, providers, job state, or authorization together with media, ML, parsing, rendering, or another processing pipeline.
---

# Service vs Engine Boundary

Service and Engine describe responsibility roles, not structural levels or required class names. Either role may be implemented by a function, type, or cohesive module inside an existing package.

## Service role

A Service owns an application use case. It may:

- load and validate required state;
- enforce authorization and use-case rules;
- coordinate repositories, storage, providers, and engines;
- select a strategy or backend;
- own application-level transactions, idempotency, and retry policy;
- update durable job/status state;
- persist and publish the application result.

A Service should say what the application is accomplishing. It should not contain deep media, ML, parsing, or rendering details.

## Engine role

An Engine owns complex processing. It may:

- execute multiple transformation stages;
- own processing-specific configuration and in-memory state;
- coordinate codecs, models, parsers, or lower-level algorithm adapters;
- produce processing results, diagnostics, and progress events;
- manage scratch resources created solely by its processing pipeline.

An Engine should not decide authorization, own HTTP concerns, update application job records directly, or coordinate unrelated use cases.

## TediaPros's Default Processing Placement

Classifying a component as a Service or Engine does not by itself determine its process. Every capability requires the TediaPros server handshake. For media behavior, record `server-plan/device-execution`: protected calculation/planning runs on the server and Electron Main executes the typed plan against original media with local runtimes/GPU.

- Non-AI media processing such as probes, thumbnails, waveforms, cutting, joining, cropping, resizing, transcoding, compression, audio splitting/merging, subtitles, watermarks, and conventional scene detection runs on the device by default. Electron Main owns the local use case and process lifecycle; the renderer owns only UI state.
- Heavy AI/models, providers that require credentials, shared data, durable jobs, batches that must continue after the client closes, or processing that needs centralized resources run on the server by default.
- Hybrid flows must have the server return structured analysis results such as transcripts, timestamps, regions, timelines, or processing plans; the client applies the results to the original media using a local engine whenever possible.
- Do not upload original media to the server solely to perform a local operation. When server-side AI needs content, send only the minimum required by the contract, such as audio, frames, chunks, or a proxy; make consent, size limits, retention, and cleanup explicit.
- Protected calculations, system prompts, authorization, presets, and business rules live on the server. The server returns a typed decision/plan; Electron Main owns the filesystem, packaged local runtime, GPU process, progress, cancellation, and output. Do not reduce the server to a generic command or prompt forwarder.
- Conventional rendering/transcoding of user-owned original media stays on the device. Server-side media processing is limited to data already owned by the server or the minimum audio/frame/chunk/proxy required by a named AI contract; it must not become an alternate upload-and-render backend.

Use `electron-boundary` and `external-runtime` for engines that run on the device; use `client-server-contract` for server or hybrid flows. An engine/model that runs on the server must not be declared as a client runtime.

FFmpeg/media runtimes, AI providers/runtimes, storage, and queues are shared infrastructure surfaces. A Service/Engine must receive a capability or port from the corresponding owner instead of resolving executables, creating provider/storage/queue clients, or reading credentials itself. Use `infrastructure-boundary` before adding or changing these dependencies.

When an Engine owns a non-trivial algorithm, performance-sensitive data structure, numerical computation, optimization/search, or media/ML/parsing kernel, use `algorithm-engineering` for its correctness and resource contract. This does not require creating a separate Engine when a cohesive function or module remains sufficient.

When a Service or Engine starts concurrent work, shares mutable state, uses worker pools/queues, or coordinates cancellation and ordering across parallel stages, use `concurrency-engineering`. The Service still owns application workflow state; the concurrent component owns only its scoped execution and cleanup.

## Lifecycle ownership

- The Service owns durable workflow state, business retries, idempotency, and mapping processing outcomes to application status.
- The Engine must honor cancellation/deadlines supplied by its caller and stop work promptly when safe.
- Engine progress should use a processing-neutral callback, channel, or event contract; the Service decides whether and how to persist or expose it.
- The Engine cleans up its scratch resources. The Service coordinates cleanup of application records or externally owned artifacts.
- Return structured errors that let the Service distinguish cancellation, invalid input, unavailable dependencies, and processing failure without depending on low-level implementation text.

## When one component is enough

- Use only a Service when processing is trivial and orchestration is the main complexity.
- Use only an Engine when the caller already owns the workflow and the capability is purely processing.
- Use neither when an ordinary function or module is sufficient.

Do not add a Service that only forwards one call or an Engine that only renames a helper.

## Dependency direction

Prefer:

```text
entrypoint
    -> service/use-case
        -> engine
        -> repository/storage/provider ports
```

An Engine may depend on lower-level algorithm/model/codec adapters. It should not depend upward on an application Service.

## Interface and port rule

Introduce a port/interface when external infrastructure must be isolated, multiple implementations exist now, runtime selection is required, or dependency inversion establishes a real boundary.

A test substitute may confirm that a boundary is useful, but mocking convenience alone is not enough. In Go, prefer narrow consumer-owned interfaces. Do not create an interface for every implementation.

## Final check

- Is orchestration separate from processing detail?
- Are durable state and authorization outside the Engine?
- Are cancellation, progress, error, and cleanup ownership explicit?
- Can the Engine implementation change without rewriting the use case?
- Do Services/Engines consume shared infrastructure through one explicit owner instead of feature-private integrations?
- Have unnecessary Service-to-Service chains and Engine wrappers been avoided?
