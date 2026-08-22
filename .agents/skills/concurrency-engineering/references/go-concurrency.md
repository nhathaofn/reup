# Go Concurrency

Read this entire reference when a feature uses goroutines, channels, `context`, `sync`, `sync/atomic`, worker pools, or pipelines.

## Ownership and Structured Lifetime

- A function that creates a goroutine must identify the owner that cancels it and waits for it to finish. Do not let a goroutine outlive the state, channel, or dependency it uses.
- Pass `context.Context` from the caller to request-/operation-scoped work; do not replace the caller's context with `context.Background()` inside the pipeline.
- Invoke the cancel function returned by `WithCancel`/`WithTimeout` on every return path to release timers and descendant work.
- Use a `WaitGroup` or equivalent coordinator to join. Call `Add` before the goroutine can run; each unit calls `Done` exactly once; do not copy synchronization primitives after use.

## Channel contract

- Specify the producer, consumer, element ownership, and closer for every channel.
- The sender/coordinator closes an outbound channel after the final send. The receiver does not close an inbound channel.
- If downstream may exit early, every upstream send must be able to select cancellation or be drained by an intentional owner.
- A buffer is a throughput/backpressure decision, not a deadlock fix. Capacity must be justified by the number of in-flight tasks or the stage contract.
- Do not use one channel both to carry data and implicitly represent multiple lifecycle states when that makes the contract ambiguous; a structured result is usually clearer.

## Shared State and Synchronization

- Go maps are unsafe with concurrent writes or reads/writes. Protect the entire invariant with one owner goroutine or an appropriate lock.
- Choose `Mutex` until `RWMutex` has a demonstrated benefit; a reader lock must still cover the correct invariant and must not be implicitly upgraded to a writer lock.
- Define lock order when multiple locks are required. Minimize nested locking; do not hold a lock across channel send/receive, callbacks, or potentially blocking I/O without a clear proof.
- Use atomics for independent counters/flags/pointers with clear transitions. Do not mix atomic and non-atomic access to the same state; do not use an atomic flag to publish a mutable aggregate without synchronization.
- Data sent through a channel must have clear ownership after the send; do not continue mutating a slice/map/pointer while the receiver may read it.

## Worker Pools, Errors, and Ordering

- Worker and queue counts must be bounded; base worker count on CPU-bound/I/O-bound workload and benchmarks, not on item count.
- The coordinator owns task admission, close, cancellation, first-error/all-error semantics, and join.
- If the first error invalidates the result, cancel sibling work and still wait for cleanup. If partial results are required, the contract must identify which items succeeded/failed.
- Assign sequence numbers before fan-out when output requires deterministic order. Fan-in may buffer/reorder by sequence, but the reorder buffer must also be bounded.
- Do not add `golang.org/x/sync/errgroup` merely for convenience when the standard library and current owner are clear enough; if the dependency already exists or the boundary genuinely needs it, limit concurrency and understand its cancellation semantics before use.

## Verification Appropriate for Go 1.22

- The TediaPros server currently uses Go 1.22; do not rely on concurrency-testing APIs introduced in newer Go versions.
- Use controllable channels/barriers/hooks to force the interleaving under test. `time.Sleep` is not synchronization; a timeout only guards against an indefinitely hanging test.
- Run targeted tests repeatedly when checking schedule-sensitive invariants, and run `go test -race` on the affected package.
- Test cancellation while workers are blocked on admission, receive, send, and dependency calls as appropriate to the implementation.
- Test that the owner waits for every child to stop. Avoid asserting an absolute process-wide goroutine count; prefer lifecycle signals from the component under test.
