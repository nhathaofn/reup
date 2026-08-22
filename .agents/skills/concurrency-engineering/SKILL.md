---
name: concurrency-engineering
description: Use when Promedia code introduces or changes goroutines, channels, locks, atomics, worker pools, parallel stages, shared mutable state, worker threads, message ports, concurrent cancellation, or behavior vulnerable to races, deadlocks, leaks, starvation, or nondeterministic ordering. Do not use for ordinary async I/O without shared state or parallel execution.
---

# Concurrency Engineering

Concurrency is correct only when ownership, synchronization, and lifecycle are explicit; running faster does not prove correctness.

- Use `algorithm-engineering` for parallel algorithms; use `service-engine-boundary` when processing coordinates workflow state.
- Use `electron-boundary` when workers/processes/messages cross Electron; use `change-impact` when changing a shared contract.

## Mandatory Concurrency Note Before Coding

Before the first edit, record:

1. Concurrent units and the lifecycle owner of each unit.
2. Whether data is immutable, transferred, single-owner, or shared; who may write it.
3. The synchronization protecting each invariant.
4. Bounds for workers, in-flight tasks, queues/buffers, and behavior when full.
5. How cancellation/deadlines unblock every send, receive, wait, and message.
6. The owner responsible for close/join, error semantics, and output ordering/tie-breaking.
7. Test oracles for races, deadlocks, leaks, cancellation, and ordering.

If ownership, ordering, or cancellation is unclear and affects behavior, ask before implementing the dependent portion.

## Design gate

- Prefer immutable data, ownership transfer, or a single owner. Shared mutation must be synchronized around the entire invariant.
- Every goroutine/thread/task has an owner and stop and join/wait paths; no ownerless fire-and-forget work.
- Workers, queues, and buffers must be bounded; when full, use backpressure, cancellable blocking, or a structured error.
- Every blocking point has success/error/cancellation paths; downstream exit must not strand upstream work.
- The sender/coordinator closes a channel exactly once after the final send; the receiver does not close an inbound channel.
- A lock protects a named invariant; do not perform callbacks/I/O/blocking work while holding a lock. Atomics are only for small, independent state.
- When the contract requires determinism, do not depend on the scheduler, map iteration, or message arrival; assign stable sequence/tie-breaking before fan-out.

## Routing

- When using Go goroutines, channels, `context`, `sync`, `sync/atomic`, worker pools, or pipelines, read [go-concurrency.md](references/go-concurrency.md).
- When using Node worker threads, Web Workers, Electron utility processes, `MessagePort`, transferable buffers, `SharedArrayBuffer`, or `Atomics`, read [node-electron-concurrency.md](references/node-electron-concurrency.md).
- When changing non-trivial synchronization or lifecycle behavior, read [concurrency-testing.md](references/concurrency-testing.md) before selecting a test strategy.

## Flags

- The operation is small, so it cannot race; the buffer is large, so it cannot block.
- An atomic flag can protect aggregate shared state; `Promise.all` makes CPU-bound JavaScript multithreaded.
- A `sleep` makes the test stable, so synchronization must be correct.

When a red flag appears, return to the concurrency note; do not patch the problem with a large buffer, delay, or random retry.

## Completion gate

1. Every task/goroutine/worker has an owner and stop/join paths; resources are released on every terminal path.
2. Test bounds/backpressure, errors, ordering, and shared-state invariants according to risk.
3. For Go, run targeted tests and `go test -race` when the environment supports it; report when it was not run.
4. Do not use a timing-based pass or one successful run as evidence.
5. Use `architecture-audit` for a non-trivial change and report anything that could not be verified.
