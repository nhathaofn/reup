# Performance and Resource Validation

Read this reference when there is a performance requirement, large dataset, optimization, streaming, concurrency, or a claim of reduced CPU/memory/latency.

## Define Before Measuring

- Convert requirements into concrete metrics and budgets: latency percentile, throughput, CPU time, peak/RSS memory, allocations, startup time, or maximum input size.
- Record workload shape, input distribution, scale, and concurrency. A number without an associated workload is not a performance contract.
- Choose a baseline: the current implementation, a simple reference, or the latest release. Keep output and correctness contracts equivalent across candidates.

## Trustworthy Benchmarks

- Exclude setup, fixture loading, network, and I/O from the measurement region when they are not part of the algorithm; include them when the end-to-end budget genuinely covers them.
- Run multiple samples under the same conditions, keeping the toolchain, OS/architecture, power state, and background load as stable as practical.
- For Go, use `testing.B`, report allocations when meaningful, and use `benchstat` for A/B comparisons instead of comparing a single number.
- For JavaScript/TypeScript, account for warm-up/JIT/GC; avoid benchmarks in a renderer with uncontrolled animations or event workloads.
- Do not use a microbenchmark to claim end-to-end latency when serialization, IPC, filesystem, or network costs are significant.

## Scaling and Adversarial Inputs

- Measure enough scales to reveal the growth trend; compare it with expected complexity, but do not infer Big-O through curve fitting alone.
- Add plausible worst-case or degenerative inputs: duplicates, skew, collisions, deeply nested data, incompressible data, already-sorted data, or malformed input, depending on the domain.
- Track timeouts, queue growth, goroutine/task leaks, peak memory, and temporary disk usage. Timeout/OOM on valid or untrusted input must be classified as behavior that requires handling.

## Optimization workflow

1. Measure the baseline and confirm the bottleneck with profiling when the cost of the change is significant.
2. Change one explainable primary cause.
3. Run the correctness suite before trusting the benchmark.
4. Repeat the A/B comparison and keep the optimization only when its benefit exceeds noise, complexity, and maintenance cost.
5. Record the environment, command, workload, sample count, and limitations in the report.

Parallelism must have bounded workers/queues, cancellation, and backpressure. Compare both single-worker and target-concurrency results to detect coordination overhead or contention.
