---
name: client-server-contract
description: Define and change the TediaPros Go server and Electron client API contract without producer-consumer drift. Use when adding or modifying endpoints, methods, request or response fields, status/error semantics, authentication, CORS behavior, base URL configuration, timeouts, or client API consumption.
---

# Client-Server Contract

Treat the server endpoint and every client consumer as one coordinated contract change.

## Inspect first

1. Find route registration, handler, middleware, request/response types, and tests on the Go server.
2. Find base URL ownership, request construction, runtime parsing/validation, state/error mapping, and UI consumers in the client.
3. Search route literals, JSON field names, status values, environment keys, and fixtures.
4. Use `change-impact` when changing an existing contract so indirect consumers are classified before editing.

## Contract definition

For the changed operation make these explicit:

- HTTP method and route;
- path/query/header/body inputs and validation;
- success status and response fields;
- error statuses and stable machine-readable meaning;
- authentication/authorization and CORS expectations;
- timeout, cancellation, retry, and idempotency behavior;
- compatibility expectations for existing consumers.

Do not require a universal response envelope unless current use cases need one.

The startup contract is mandatory: the Electron shell remains unavailable until Electron Main validates the versioned TediaPros handshake. Persist a user-entered endpoint only after that handshake succeeds. The default loopback endpoint may be configured once; do not duplicate it across features.

Protected logic uses named operation contracts. Do not expose a generic endpoint that accepts arbitrary system prompts or provider payloads from the client. Long operations define job identity, idempotency, progress/status, cancellation, expiry, and minimum-data upload rules explicitly.

## Server responsibilities

- Use explicit request/response structures when the payload has a stable shape.
- Validate untrusted input at the HTTP boundary and return appropriate status codes.
- Keep business logic outside transport handlers once it becomes non-trivial.
- Do not expose internal error text, filesystem paths, SQL details, secrets, or sensitive data.
- Honor request cancellation/deadlines in downstream work.
- Keep serialization names intentional and covered by contract-level tests.

## Client responsibilities

- Keep server base URL/configuration under one clear owner instead of rebuilding it in multiple screens.
- Build URLs safely and encode path/query input.
- Apply timeouts/cancellation deliberately and do not retry unsafe mutations without idempotency.
- Check status and content before assuming a successful JSON shape.
- Validate untrusted response data at runtime where fields drive behavior; a TypeScript cast alone is not validation.
- Map technical failures to actionable Vietnamese i18n UI messages without discarding diagnostic categories needed for logs.

## Compatibility and source of truth

For a small internal API, explicit Go DTOs, client types/runtime validation, and integration tests are sufficient. Introduce OpenAPI or code generation only when endpoint count, external consumers, or demonstrated drift justifies the maintenance cost.

Coordinate breaking changes in one task when possible. If staged compatibility is required, document which side accepts old/new shapes and the condition for removing compatibility code.

## Verification

Verify the real server -> network -> client parsing/state path when the environment allows it. Cover at least success plus a relevant invalid/error path. If a live dependency cannot be used, use anonymized fixtures that preserve the real payload structure and state the limitation.

Do not conclude the contract works from isolated server or client unit tests alone.
