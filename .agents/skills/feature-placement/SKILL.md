---
name: feature-placement
description: "Decide where non-trivial Promedia behavior belongs using two separate decisions: code location and responsibility role. Use before changes that may add or move functions, files, packages, types, Services, or Engines. Do not use for formatting, documentation-only edits, or isolated literal changes."
---

# Feature Placement

Choose the smallest location that owns the behavior clearly. Treat code location and responsibility role as separate decisions.

## Inspect before deciding

Before adding or moving an abstraction:

1. Read the nearest relevant `AGENTS.md`.
2. Inspect the directory/package around the requested behavior.
3. Search for existing owners, callers, related implementations, and tests.
4. Inspect the primary caller and likely implementation location.
5. Identify the current dependency direction.

Do not classify a feature from its name alone.

## Decision A: code location

Choose one structural location.

### Existing owner

Prefer the current function, type, or module when the behavior extends the same responsibility and does not make that owner incoherent.

### New function

Use a function when the operation is small and cohesive, has explicit inputs and outputs, and belongs to an existing owner.

### New file or module

Use a dedicated file/module when several related functions or types form one concept and keeping them in the current file would mix responsibilities. A new file is an organizational unit, not automatically a new architectural boundary.

### New package

Use a package only when a stable capability owns several cohesive elements, has a meaningful minimal API, and can keep dependencies directional. Do not create a package for a tiny helper or to reduce file length.

Repository-specific meaning:

- In Go, a directory is a package; adding a `.go` file inside it does not create a new package boundary.
- In the Electron client, a TypeScript file is a module. A folder may group a capability, while a separate npm/workspace package requires a much stronger ownership or distribution reason.
- Electron `main`, `preload`, and `renderer` are runtime/security boundaries. Use `electron-boundary` when behavior crosses them.

## Decision B: responsibility role

After selecting the location, classify the behavior as one of these roles.

### Plain behavior

This is the default. Use a function or ordinary type when Service/Engine responsibilities are not present.

### Service role

Use when the behavior coordinates an application use case across repositories, storage, providers, engines, transactions, durable state, or authorization rules.

### Engine role

Use when the behavior owns a non-trivial transformation or processing pipeline such as media, ML, rendering, parsing, planning, or execution.

Service and Engine are roles inside a file/module/package, not structural levels above a package. A function can implement either role when a dedicated class or struct would add no value.

## Decision order

1. Can an existing owner accept the behavior without losing cohesion?
2. If not, what is the smallest structural unit that establishes clear ownership?
3. Does the behavior genuinely need a Service or Engine role, or is plain behavior sufficient?
4. Can dependencies continue to point from entrypoints and workflows toward lower-level capabilities?

When the choice remains ambiguous, read [references/decision-matrix.md](references/decision-matrix.md). Do not load it for an obvious extension to existing code.

## Naming guardrails

Reject vague new names such as `Manager`, `Helper`, `Utils`, `Common`, `Processor`, `Core`, or `Misc` unless the repository already gives the term a precise responsibility.

Prefer names based on owned capability or use case. Do not rename established project concepts solely to satisfy this skill.

## Placement note

For a non-trivial placement, state briefly before coding:

- existing owner;
- chosen location;
- responsibility role;
- reused and new abstractions;
- dependency direction.

For an obvious change inside an existing owner, a single concise sentence is enough. Do not require user approval unless the placement would materially change the requested scope.
