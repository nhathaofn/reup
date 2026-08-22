# Node and Electron Concurrency

Read this entire reference when a feature uses Node worker threads, Web Workers, Electron utility processes, `MessagePort`, transferable buffers, `SharedArrayBuffer`, or `Atomics`.

## Choosing the Execution Boundary

- `Promise.all` only coordinates Promises; it does not move CPU-bound JavaScript to another thread.
- Use asynchronous APIs for I/O-bound work. Use worker threads/Web Workers/utility processes for CPU-bound work large enough to justify cloning, transfer, and scheduling costs.
- Do not run CPU-heavy or blocking work on Electron main or the renderer UI thread. Use `electron-boundary` to choose the main/preload/renderer/worker/process contract.
- Do not create a new worker for every item in a large workload. Use a pool with bounded worker count and pending queue; the pool owner manages startup, admission, cancellation, and shutdown.

## Message and Memory Ownership

- Every task has an ID, a serializable request payload, and exactly one terminal result/error. The owner keeps the pending map and removes entries on success, error, cancellation, or worker exit.
- Prefer immutable messages or ownership transfer of an `ArrayBuffer` when appropriate. After transfer, the sender must not continue using the detached buffer.
- Structured cloning has CPU/memory costs; measure real payloads before choosing clone or transfer.
- Use `SharedArrayBuffer` only when messages/transfers do not satisfy the use case. When used, every shared field must have an explicit layout, writer/reader ownership, and `Atomics` protocol; do not read/write shared memory outside the protocol.
- Do not send objects with behavior/prototypes and expect the worker to receive the same semantics; the message contract relies only on cloneable/transferable data.

## Lifecycle, Cancellation, and Stale Results

- Handle `message`, `messageerror`, `error`, and `exit`; a task resolves/rejects only once even when multiple events occur.
- An abnormal worker exit must reject or requeue pending tasks according to the defined semantics; do not leave Promises pending.
- Cancellation needs an operation/task ID and a cooperative stop signal when the algorithm can check it. `terminate()` is a cleanup fallback, not a replacement for the pool's cancellation contract.
- When a view/operation changes, a generation or operation ID prevents stale results from updating new state. Teardown must remove the exact listener and release the port.
- During shutdown, the owner stops accepting new tasks, processes or cancels the queue according to the contract, waits for in-flight tasks, closes ports, and terminates remaining workers.

## Ordering and Backpressure

- Message arrival order is not the output ordering contract. Assign sequence numbers before dispatch and reorder in the coordinator when stable output is required.
- When the queue is full, admission must wait with cancellation or return a structured rejection; do not grow the pending array without bounds.
- Do not use synchronous IPC to wait for a worker/process result because it blocks the calling Electron thread.

## Verification

- Use a small fake task with a barrier/message hook to test interleavings; do not rely on random delays.
- Test worker error/exit during a task, duplicate terminal events, cancellation while queued/in-flight, stale results, queue saturation, and shutdown with pending work.
- Test transfer semantics to ensure the sender does not use a transferred buffer and the receiver gets the correct byte range.
- If shared memory is used, test protocol state transitions under multiple schedules and verify that no non-atomic access occurs outside immutable regions.
