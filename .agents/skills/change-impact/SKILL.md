---
name: change-impact
description: Analyze the impact radius of a non-trivial Promedia code change and identify related callers, consumers, contracts, configuration, tests, fixtures, and cross-process boundaries that may also require updates. Use before editing shared behavior, signatures, APIs, IPC, schemas, config, public exports, or cross-layer data flow, and recheck before completion. Do not use for isolated formatting or documentation-only changes.
---

# Change Impact

Prevent partial changes by tracing what reads, writes, calls, exposes, persists, configures, or verifies the behavior being edited.

This skill identifies required in-scope work; it does not authorize unrelated cleanup or expand the user's requested outcome.

## Before editing

1. Identify the source of truth for the behavior, symbol, route, channel, field, config key, or format being changed.
2. Search exact definitions and references with `rg`; inspect direct callers and callees, not only matching filenames.
3. Trace data and control flow across relevant boundaries:
   - Go entrypoint, handler, use case, processing, repository/storage;
   - server endpoint and Electron client consumer;
   - Electron main, preload, renderer, and window typings;
   - config loader, environment examples, defaults, and deployment inputs;
   - schema/migration, model, query, fixture/seed, and serialization;
   - UI template, selector, event handler, state, and feedback.
4. Inspect tests, fixtures, documentation, examples, and generated or packaged inputs that encode the old behavior.
5. Distinguish related locations that must change from locations that should intentionally remain compatible.

When the change touches a named contract or crosses a boundary, read the relevant rows in [references/impact-checklist.md](references/impact-checklist.md). Do not load the whole checklist for a clearly local function edit.

## Impact map

For a non-trivial change, keep a concise map containing:

- source of truth;
- direct callers/readers/writers;
- contracts and boundary consumers;
- config, persistence, fixtures, docs, and user-facing behavior;
- targeted verification for each affected path.

The map is a working aid, not a commitment to modify every discovered file. If a related change would alter compatibility or expand scope materially, report it and request direction when required.

## During editing

- Change the source of truth first, then update dependents along the traced flow.
- Preserve compatibility intentionally; do not accidentally support both old and new behavior through duplicated logic.
- Avoid broad replacements when the same name/value has unrelated meanings.
- Update contract definitions before consumers when possible so mismatches become visible.
- Keep unrelated cleanup out of the patch.

## Before completion

1. Repeat searches for the old symbol, route, channel, field, config key, literal, import path, and renamed file where relevant.
2. Inspect the final changed-file set or diff for missing counterpart changes.
3. Revisit each impact-map item and classify it as updated, verified unchanged, intentionally compatible, or deferred with a reason.
4. Run the smallest relevant tests, type checks, lint, or static checks allowed by `AGENTS.md`. Do not run a build unless requested.
5. Verify at least one real boundary path when the change crosses API, IPC, storage, file, or UI data flow.

Do not conclude that the change is complete merely because the edited file passes its local test.

## Handoff

For non-trivial changes, summarize the affected paths, related locations updated, related locations checked but unchanged, deferred or blocked follow-ups, and verification performed. Keep the summary proportional to the impact radius.
