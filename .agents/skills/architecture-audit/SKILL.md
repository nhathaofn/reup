---
name: architecture-audit
description: Review a completed non-trivial TediaPros feature or refactor for readability, unnecessary abstractions, missing structure, misplaced responsibilities, dependency problems, boundary drift, and incomplete change impact. Use before declaring implementation complete; do not use for isolated formatting or documentation-only edits.
---

# Architecture Audit

Audit the implemented change and the surrounding callers, not the intended design alone.

## Evidence and authority

- Prefer the actual diff plus relevant surrounding code.
- If a diff is unavailable, inspect the explicit changed-file scope, callers, and consumers, and disclose that limitation.
- In an implementation task, correct issues introduced by the current change when they remain within scope.
- In a review-only task, report findings without modifying code.
- Do not expand into unrelated cleanup. Record pre-existing debt separately.

## Abstraction audit

For each new function group, type, interface/port, file/module, package, Service, Engine, repository, provider, or adapter, ask:

1. What unique current responsibility does it own?
2. Who calls it?
3. Could an existing owner hold the behavior clearly?
4. Does it mostly forward another call?
5. Is it justified by current requirements?
6. Is its public surface smaller than the implementation it hides?

Flag both over-engineering and behavior that has been placed into an already unrelated owner.

## Responsibility audit

Look for:

- unrelated responsibilities in one module/package;
- application workflow mixed with HTTP/UI/storage details;
- algorithms embedded in handlers or Services;
- Engines that own authorization or durable application state;
- Services or Engines that only rename a function;
- repeated conditionals selecting implementations across callers;
- interfaces created only for mocking convenience.

Service and Engine are responsibility roles, not structural levels. A function may be enough.

## Package and dependency audit

Flag circular or bidirectional dependencies, dumping-ground packages, duplicate concepts, excessive re-exports, unnecessary public identifiers, and packages created only to reduce file length.

Respect the repository's established direction. Do not impose a generic layering diagram when the current architecture has a simpler valid shape.

## Infrastructure boundary audit

When the change touches FFmpeg/media runtime, AI runtime/provider, storage or queue, verify that:

- config, credential, connection/process and lifecycle have one explicit owner;
- features consume a narrow capability/port and do not create private executable paths, SDK clients, storage connections or queue topics;
- the composition root wires concrete infrastructure and feature packages do not import deployment details;
- transport retry/health/cleanup stay with infrastructure while business retry/idempotency stay with the Service;
- reuse has not produced a generic service locator or one manager that mixes unrelated infrastructure lifecycles.

Search surrounding feature folders for direct calls that bypass the owner, not only the changed file.

## Readability and maintainability audit

Read every changed file end-to-end and check that:

- names describe capability or responsibility without requiring comments to decode intent;
- control flow is direct, stale branches/imports are removed, and related behavior is kept together;
- a function or module does not mix unrelated reasons to change;
- duplicated literals, selectors, contract values, and translation keys have one intentional source of truth;
- comments explain non-obvious decisions in Vietnamese instead of narrating statements;
- tests and verification target observable behavior rather than implementation wording.

Do not split a cohesive function or file only because it is long. Split when the resulting owner has a distinct responsibility and a clear dependency direction.

## Boundary and impact audit

Check every boundary touched by the change:

- Go handler/use case/repository or storage;
- server/client API contracts;
- Electron main/preload/renderer contracts;
- configuration and environment examples;
- persistent schemas, migrations, fixtures, and file formats;
- UI state, errors, loading, accessibility, and user-facing text;
- tests and documentation that encode changed behavior.

If `change-impact` was used, compare the final implementation with its impact map and repeat targeted searches for old names, values, routes, channels, or fields.

## Concurrency audit

When the change touches concurrent execution, inspect the final implementation against its concurrency note:

- every goroutine/thread/task has a lifecycle owner, stop path and join/wait path;
- shared mutable invariants have one synchronization strategy and no mixed protected/unprotected access;
- worker, queue and buffer growth is bounded with explicit backpressure;
- blocking sends, receives, waits, ports and listeners unblock on error and cancellation;
- close/terminate ownership is single and cleanup happens on every terminal path;
- ordering, duplicate/lost result behavior and stale-result handling match the contract;
- verification covers race, deadlock, leak and cancellation risks introduced by the change.

## Scope decisions

Correct or request correction when an issue:

- was introduced by the current change;
- leaves a required caller or contract inconsistent;
- creates a clear correctness, security, or maintainability regression;
- directly blocks the requested behavior.

Do not change unrelated debt solely because it is nearby.

## Verification and report

Use the smallest relevant verification allowed by `AGENTS.md`. Do not run a build unless the user requested one. Distinguish `not run`, `passed`, and `failed`; absence of an unrequested build is not a failure.

Report findings by severity with file/line evidence, impact, and the smallest correction. Include corrections made, intentionally unchanged related areas, deferred issues, and verification when they exist. If there are no findings, return a concise scope and verification summary instead of an empty fixed template.

Do not describe the whole feature as behaviorally verified when only an architecture review was performed.
