---
name: package-boundary
description: Decide whether Promedia code should remain in its current Go package or TypeScript module/folder, or move behind a new package boundary. Use when a capability is mixing responsibilities, adding several cohesive modules, exposing unclear APIs, or creating dependency cycles.
---

# Package Boundary

Create boundaries around owned capabilities, not file counts.

## Repository terminology

- Go: a directory is a package. Prefer `internal` for project-only capabilities and keep exported identifiers minimal.
- TypeScript: a source file is a module; a folder is primarily an organizational boundary. Creating a separate npm/workspace package is exceptional and needs independent ownership, reuse, tooling, or distribution requirements.
- Electron `main`, `preload`, and `renderer` are runtime/security boundaries, not ordinary folders. If a change crosses them, use `electron-boundary` as well.

## Inspect first

Inspect the current tree, imports, exports, tests, callers, neighboring owners, and composition point. Determine whether the problem is responsibility, visibility, dependency direction, or only file size.

## Keep the current boundary when

- the behavior shares the owner's reason to change;
- a new boundary would expose internal details;
- the proposed package would mostly forward calls;
- separation would create bidirectional dependencies;
- a cohesive file/module extraction is sufficient;
- the only concern is line count.

## Split when

At least one concrete boundary reason exists, preferably supported by more than one signal:

- a stable capability contains several cohesive elements;
- it needs an explicit minimal API;
- independent dependencies or resource requirements should be isolated;
- it has a distinct lifecycle or configuration;
- the current owner mixes unrelated reasons to change;
- callers already depend on a coherent subset of behavior;
- a cycle can be removed by assigning contract ownership clearly.

Testability supports a split but does not justify a package by itself.

## Boundary design

For a proposed boundary identify:

- one-sentence responsibility;
- data, behavior, and lifecycle it owns;
- adjacent responsibilities it does not own;
- minimal public surface;
- allowed and forbidden dependencies;
- callers and composition point;
- tests that verify the boundary.

For Go, place an interface near the consumer that owns the contract when inversion is justified. For TypeScript, avoid barrel exports that merely hide unclear ownership.

## Dependency cycles

If A needs B and B needs A:

1. identify which side owns the shared contract;
2. move behavior or the narrow contract toward that owner;
3. invert the dependency only when there is a real boundary;
4. do not create `common`, `utils`, or a third dumping-ground package to hide the cycle.

Do not turn a code package into a separate executable or network service without explicit operational requirements.

## Result

Before a non-trivial restructure, record the current responsibility, keep/split decision, proposed owner, dependency direction, public surface, and migration impact. Afterward, check imports/exports again and confirm that no new cycle or unnecessary public API was introduced.
