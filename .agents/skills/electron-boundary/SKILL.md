---
name: electron-boundary
description: Design and implement safe Promedia Electron main, preload, and renderer boundaries. Use when adding or changing IPC, preload APIs, filesystem or process access, dialogs, credentials, notifications, native integrations, window behavior, or other privileged capabilities. Do not use for renderer-only visual changes.
---

# Electron Boundary

Keep privileged Electron/Node capabilities out of the renderer and expose only the application capability the UI needs.

## Ownership

| Boundary | Owns |
|---|---|
| Main | BrowserWindow lifecycle, filesystem/process/OS access, dialogs, credentials, native integrations, IPC handlers |
| Preload | Narrow typed bridge that translates renderer calls to approved main capabilities |
| Renderer | UI state and interaction through browser APIs and the exposed bridge |

Direct renderer HTTP calls are acceptable for non-privileged server communication when they do not expose secrets or require native resources. Do not route them through IPC solely for architectural symmetry.

## Before changing the bridge

1. Search existing channel names, main handlers, preload exports, renderer consumers, and `Window` typings.
2. Define a capability-oriented request, result, and error contract.
3. Decide which side owns validation, cancellation, progress, and cleanup.
4. Use `change-impact` to identify every producer and consumer of a changed bridge contract.

## Security invariants

- Keep `contextIsolation: true` and `nodeIntegration: false` unless the user explicitly requests a reviewed architecture change.
- Never expose `ipcRenderer`, raw filesystem/process objects, arbitrary channel names, or a generic `send`/`invoke` method to the renderer.
- Validate renderer input again in main before privileged work.
- Allowlist paths, protocols, commands, and external URLs according to the capability; do not trust values because they came through preload.
- Return serializable data and stable error codes/categories rather than Electron or Node internals.
- Expose the minimum method/event surface required by the current use case.

## Contract pattern

- Centralize each channel or capability name so main and preload cannot drift silently.
- Give preload methods explicit TypeScript request/response types and update renderer global typings in the same change.
- Main handlers own privileged execution and should not depend on renderer DOM or UI concepts.
- For pushed events, return an unsubscribe function from preload and remove the exact wrapped listener.
- Avoid duplicate handler registration when windows are recreated or development reloads occur.

## Cancellation, progress, and lifecycle

- Long-running work needs an operation identifier or similarly scoped contract when cancellation/progress is required.
- Renderer teardown or navigation should unsubscribe listeners and stop updating stale views.
- Main owns cancellation of native work; preload only exposes the narrow cancellation capability.
- Define cleanup for temporary files, child processes, and partial outputs on success, failure, cancellation, and app shutdown.
- When work uses worker threads, Web Workers, utility processes, MessagePorts, shared memory or bounded task pools, use `concurrency-engineering` for ownership, synchronization, backpressure, worker lifecycle and stale-result verification.

## Cross-platform behavior

Use Node/Electron path and platform APIs. Isolate unavoidable Linux/Windows differences in a small named module. Do not add macOS packaging behavior to the default workflow, and do not assume shell syntax, drive layout, separators, or executable suffixes.

## Verification

Verify the complete main -> preload -> renderer path with the real capability or a structurally accurate non-sensitive input. Check invalid input, failure, cancellation/listener cleanup where relevant, and run targeted type checks/tests without building unless requested.
