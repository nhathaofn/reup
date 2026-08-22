# Concurrency Testing

Read this entire reference when changing non-trivial synchronization, lifecycle, ordering, or shared state.

## Test oracle

- Test observable invariants: no lost/duplicated items, valid state transitions, output ordering that matches the contract, cancellation returns, and child work terminates.
- Do not assert implementation details such as lock counts or scheduler order when they are not part of the contract.
- Every regression preserves the smallest counterexample or interleaving that reproduces the failure.

## Controlling Interleavings

- Use a barrier, channel, latch, test hook, or controlled dependency to pause a task at a known point and then allow another task to run.
- Do not use `sleep` to "let the goroutine run first." A timeout only protects the test from hanging and must produce a clear failure.
- Repeating a schedule-sensitive test many times is only an additional layer; a deterministic test with a controlled interleaving remains the primary oracle.

## Mandatory Risk-Based Matrix

| Change risk | Minimum test |
|---|---|
| Shared mutation | Concurrent reads/writes against the same invariant; Go race detector |
| Lock/channel topology | The interleaving that caused the deadlock; timeout guard |
| Worker/task lifecycle | Success, error, and cancellation all join/clean up |
| Bounded queue | A full queue applies the correct backpressure/rejection and remains cancellable |
| Fan-out/fan-in | No loss/duplication; first-error/partial-result behavior matches the contract |
| Ordered output | Tied/duplicate inputs and multiple completion orders still produce the same output |
| View/operation replacement | Stale results do not update new state |

## Races, Deadlocks, and Leaks

- A race detector observes only executions that occurred; create a workload that exercises the relevant shared state and do not treat one race-free run as a complete proof.
- A deadlock test must force participants to the exact wait points. Do not enlarge a buffer to make the test pass while the contract still contains a cycle.
- A leak test should wait for the component's lifecycle signal, worker exit, or pending count to reach zero. Process-wide goroutine counts can be noisy and should be used only with a clear baseline/allowance.

## Stress and Determinism

- Use input small enough for a clear oracle but with enough contention to exercise the invariant.
- Run the same seed/input across multiple valid worker counts, including one worker and the target concurrency.
- If output must be deterministic, compare the exact ordered result across multiple runs; do not change the test to a set comparison to hide ordering drift.
- Record the seed, task ID, and current wait phase in failure messages so the failure can be reproduced.
