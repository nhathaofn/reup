---
name: algorithm-engineering
description: Engineer non-trivial Promedia algorithms whose correctness, numerical behavior, complexity, determinism, or resource use must be explicit. Use before implementing or materially changing computation-heavy algorithms, optimization/search, media/ML/parsing kernels, concurrency-sensitive processing, or performance-critical data structures. Do not use for ordinary CRUD, orchestration, UI, simple mapping/validation, or a trivial library call.
---

# Algorithm Engineering

Design and implement algorithms from verifiable specifications. Do not turn ambiguous requests into product behavior on your own, optimize by intuition, or use benchmarks in place of correctness verification.

## Boundary With Other Skills

- This skill owns the proof of correctness, algorithm selection, complexity, numerical behavior, determinism, and performance of the processing component.
- Use `service-engine-boundary` when processing is coordinated with storage, providers, durable job state, or application workflow; do not create an Engine by default merely because an algorithm exists.
- Use `feature-placement` or `package-boundary` when a function, module, type, or package must be added or moved.
- Use `change-impact` when changing a signature, configuration, data format, or shared behavior; use `client-server-contract` if results cross an API.
- Use `concurrency-engineering` when the implementation adds goroutines/threads, worker pools, shared mutable state, synchronization, parallel stages, or cancellation across concurrent work.
- Heavy processing does not belong in the Electron renderer. If workers, native processes, filesystem access, or IPC are needed, use `electron-boundary` to choose a safe boundary.

## Mandatory Preflight Before Coding

Read the nearest implementation, callers, tests, fixtures, and relevant real data. Before the first implementation edit, record a short algorithm note in commentary or the plan containing:

1. The computational objective and the oracle used to determine correctness.
2. The input domain: types, units, sizes, empty/invalid inputs, and valid limits.
3. Output semantics: ordering, tie-breaking, precision, determinism, and error states.
4. Important invariants, preconditions, and postconditions.
5. Time, memory, latency, throughput, or concurrency limits, when applicable.
6. The baseline/reference implementation and target time/memory complexity.
7. Missing product decisions and small verifiable assumptions.

If a missing oracle, semantic rule, or limit could change the algorithm, ask the user before implementing the dependent portion. You may continue investigating or build an independent test harness, but must not treat a speculative prototype as a completed implementation.

## Selecting an Algorithm

- Prefer the simplest approach that satisfies the current constraints. Compare candidates by correctness, worst-case behavior, average-case behavior when meaningful, memory growth, determinism, and operational difficulty.
- Distinguish theoretical complexity from practical costs such as allocation, caching, I/O, serialization, network, or startup. Do not infer Big-O from only a few benchmark points.
- Prefer the standard library or an existing dependency when its semantics fit. Add a dependency only when its current benefit outweighs its API, license, security, size, and maintenance costs.
- Define ordering and tie-breaking explicitly; do not depend accidentally on map iteration, scheduling, or implementation details.
- Use approximate, heuristic, or randomized algorithms only when requirements allow them; specify the quality bound, termination rule, and seed/reproducibility contract.
- Do not optimize before establishing a baseline or measuring a bottleneck, unless a constraint proves that the current approach cannot meet requirements.

## Implementing the Core

- Keep the algorithm core separate from HTTP, UI, storage, and durable job state. Accept explicit input/configuration and return structured results/diagnostics.
- Make ownership of buffers, slices, arrays, typed arrays, and scratch resources explicit; avoid hidden mutation or aliasing between the caller and algorithm.
- Check integer overflow/underflow, lossy conversions, units, boundary indices, zero-length inputs, and allocations driven by untrusted input.
- For long-running work, accept cancellation/deadlines from the caller, check them at a reasonable granularity, and return classifiable errors. Bounded concurrency and bounded queues must have clear owners.
- Add parallelism only after proving that the work is sufficiently large and independent; test races, ordering, deterministic output, and coordination cost.
- Randomized behavior must allow a fixed seed and record that seed so failures can be reproduced. Do not use the clock or a global random source as hidden input when results must be reproducible.
- Comments in Vietnamese should explain only invariants, proof ideas, numerical trade-offs, or non-obvious algorithm-selection reasons; do not narrate individual statements.

## Correctness Test Matrix

Select test classes appropriate to the risk; not every technique is required for every algorithm:

1. Example tests using real data or anonymized fixtures with independently derived expected results.
2. Boundary tests for empty/singleton, min/max, duplicates, sorted/reversed, malformed, large, and domain-appropriate adversarial inputs.
3. Differential tests against a simple reference implementation, standard library, or old implementation when a trustworthy oracle exists.
4. Property/metamorphic tests for invariants such as round trips, idempotence, conservation, monotonicity, permutation invariance, or equivalence.
5. Fuzz tests for parsers, decoders, complex/untrusted input, or APIs with large input spaces; the seed corpus must contain boundary cases and discovered failures.
6. Regression tests for every corrected counterexample; preserve the smallest input that still reproduces the failure.

Tests must not copy the implementation's control flow because they can reproduce the same defect. If output is approximate or probabilistic, read [numerical-and-probabilistic.md](references/numerical-and-probabilistic.md) before choosing the oracle and tolerance.

## Performance and Resource Validation

Make performance claims only when requirements and appropriate measurements exist. If a change is an optimization, has latency/throughput/memory limits, processes large data, or adds concurrency, read [performance-validation.md](references/performance-validation.md).

- Benchmark with inputs representative of the real distribution and at least one plausible adversarial scale or pattern.
- Exclude setup/I/O that is not part of the algorithm from the measurement region; keep inputs, environment, and comparison configuration stable.
- Measure repeatedly and compare baseline/candidate results; do not conclude from one run or from differences within noise.
- Track time, allocation/memory, and degradation with input size when they are part of the constraints.
- Profile before applying complex optimizations; keep an optimization only when tests remain correct and measurement evidence shows a meaningful benefit.

## Promedia Runtime-Specific Rules

### Go server

- Prefer table-driven tests for specific cases and native fuzzing for appropriate targets; fuzz failures must become seed/regression cases that can be rerun as ordinary tests.
- Use `testing` benchmarks and statistical comparison tools such as `benchstat` when making A/B claims. Expensive setup must remain outside the measurement region.
- Run race detection for concurrency changes when the environment permits, and clearly report when it was not run.

### TypeScript/Electron

- Keep only lightweight calculations directly tied to presentation in the renderer. Heavy processing must be placed on the server or behind an appropriate boundary so it does not block the UI thread.
- Define the limits of `number`, safe integers, `BigInt`, typed arrays, and serialization before porting an algorithm from Go or another library.
- Use the existing test runner. Do not add a test/property/benchmark framework for only one feature without a sufficiently clear benefit; a small deterministic harness within the existing boundary may be used.

## Completion gate

Before reporting completion:

1. Compare the implementation against the algorithm note and update every assumption that changed.
2. Prove that the oracle is independent of the implementation under test and that every main invariant has an appropriate test.
3. Verify malformed inputs, boundaries, cancellation, determinism, and resource limits within the feature scope.
4. Run the smallest appropriate tests/fuzz seeds/type checks/static checks; do not build unless the user requested it.
5. Report a performance improvement only when there is a baseline, repeatable results, and a documented measurement environment.
6. Use `architecture-audit` for a non-trivial change; report passed, not-run, untestable, and data/benchmark limitations separately.

Do not consider a feature complete merely because the happy path passes, a benchmark is faster, or the code appears correct without an independent oracle.
