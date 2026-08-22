# TediaPros Client-Server Foundation Design

## Product decision

TediaPros is a new Windows-only product. It does not preserve T-blao application data, identifiers, protocols, settings, update identity, or installer compatibility.

The Electron client is unusable until it completes a handshake with the TediaPros Go server. Development starts with both processes on one Windows machine. LAN deployment uses the same server binary with an explicit bind address. A later VPS deployment may require TLS and stronger authentication, but no VPS behavior is required by this phase.

## Architecture

The existing Electron + React + TypeScript client remains at the repository root. A separate Go service lives under `server/` and is released independently from the client.

The dependency direction is:

1. React Renderer owns UI state and Vietnamese i18n rendering.
2. Preload exposes narrow typed IPC operations.
3. Electron Main owns local files, dialogs, packaged runtimes, FFmpeg/GPU processes, server endpoint persistence, and HTTP transport.
4. The Go server owns system prompts, protected processing rules, provider orchestration, validation, and media planning.
5. The server returns structured results or processing plans. Electron Main applies media plans to original local files with the user's GPU.

The Go server never receives an original video or image when structured metadata, text, audio excerpts, selected frames, or no media at all is sufficient. Every future operation defines the minimum payload it needs rather than exposing a generic prompt endpoint.

## Mandatory server gate

At startup, the client asks Electron Main to perform `POST /api/v1/session/handshake`. The application shell and all local tools remain unavailable until the response identifies the expected TediaPros server contract.

The default development endpoint is `http://127.0.0.1:48191`. A user may enter another endpoint. Electron Main stores it only after a successful handshake.

- Plain HTTP is accepted only for loopback, private IPv4, link-local IPv4, IPv6 ULA, and IPv6 link-local addresses.
- Public hosts require HTTPS so a later VPS deployment does not normalize an unsafe public endpoint.
- Renderer never performs server fetches directly and never receives arbitrary filesystem access.
- CORS is not used as authentication because the transport originates in Electron Main.

The first LAN phase relies on network reachability: a copied client outside the configured LAN cannot reach the server and therefore remains at the connection gate. This is access gating, not tamper-proof DRM. A determined attacker could patch a desktop binary; stronger licensing or device authentication is a separate product capability.

## Server contract v1

The foundation exposes:

- `GET /api/v1/health`: liveness for operators and diagnostics.
- `POST /api/v1/session/handshake`: verifies product, API version, Windows platform, and client metadata; returns server identity and capabilities.

All responses use JSON. Public errors contain a stable code and Vietnamese message without provider bodies, paths, credentials, or internal stack details. Request bodies have explicit size limits and unknown JSON fields are rejected.

Long-running AI/media planning endpoints added later use job IDs, bounded status transitions, progress, cancellation, idempotency keys, and expiry. They are operation-specific and do not accept arbitrary prompts from the client.

## Provider migration

Gemini, OpenAI, Ollama, ElevenLabs, and future provider integrations are migrated feature by feature after the mandatory connection foundation. Existing provider behavior remains visible to the user, but provider calls and system prompts move to named Go endpoints.

API key ownership is explicit for each endpoint:

- owner-managed credentials are supplied to the server through environment or server configuration;
- user-supplied credentials may be submitted through the client to a named validation/operation endpoint, but the provider request still originates on the server;
- no master credential or protected prompt is embedded in the Electron package.

Until a feature's provider workflow has moved, the feature is not considered server-migrated. The client-wide handshake gate alone is not evidence that prompts or provider logic are protected.

## Local media processing

FFmpeg, FFprobe, fonts, Python media helpers, and the existing engine lifecycle retain the current project packaging and installation behavior. This is an explicit product exception to the previous external-runtime policy.

Electron Main owns media probing and rendering against user-selected local paths. A server response may contain normalized timestamps, regions, filters, scene decisions, subtitle plans, or another typed render plan; it must not contain server filesystem paths or executable commands.

## Brand and compatibility

All active identifiers become TediaPros equivalents, including package name, Electron app IDs, product names, protocol, environment prefixes, localStorage keys, logs, task/firewall names, documentation, and release artifact names. No compatibility alias or old-data migration is retained.

Historical legal attribution to third-party authors remains intact when it is a required notice rather than a product identifier.

## UI and i18n

The renderer keeps the Warm Minimal / Beige Minimalism direction. The current React 19 + TSX + colocated CSS structure remains; Tailwind is not introduced.

The initial locale set contains Vietnamese only:

- locale ID: `vi`;
- deterministic fallback: `vi`;
- no language selector while only one locale exists;
- new or touched user-facing text uses scoped i18n keys;
- each capability keeps its locale dictionary in its own file when it grows beyond the app-shell dictionary.

## Windows scope and verification

Development, testing, packaging, and release guidance target Windows only. macOS and Linux package targets are removed from the product contract.

Ordinary verification does not build or package. The root verification gate runs Go tests, TypeScript typecheck, client unit tests, and the architecture check. Packaging is run only when explicitly requested and then only for Windows.

## Delivery stages

1. Foundation: project skills, product identity, Vietnamese i18n structure, Go server handshake, typed Electron transport, mandatory connection UI, and non-build verification.
2. Provider migration: move each existing Gemini/OpenAI/Ollama/ElevenLabs workflow to a named server operation with contract tests.
3. Media planning: move protected decision logic to server plans while preserving local GPU rendering and minimum-data transfer.
4. LAN acceptance: run server on a LAN bind address and verify from a second physical Windows client; add TLS/client authentication before any exposure beyond a trusted private network.
