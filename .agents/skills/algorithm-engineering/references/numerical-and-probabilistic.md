# Numerical and Probabilistic Verification

Read this reference when an algorithm uses floating point, fixed point, randomness, sampling, optimization, ML scores, or approximate results.

## Numerical contract

- Specify units, range, required precision, and behavior for `NaN`, positive/negative infinity, signed zero, overflow, underflow, or out-of-domain values.
- Choose `int`, fixed point, `float32`, `float64`, `number`, `BigInt`, or a decimal representation according to the data contract; do not choose solely for implementation convenience.
- Do not use exact equality for floating point when calculations involve rounding. Tolerance must come from domain error or error analysis, not one arbitrary epsilon for every magnitude.
- When scale varies widely, consider combining absolute and relative tolerances. Near-zero values need absolute tolerance; large values usually need relative tolerance.
- Verify results on supported Windows architectures when numerical behavior depends on architecture, compiler, native libraries, or parallel execution order.

## Stability and Convergence

- Distinguish a mathematically correct formula from a numerically stable implementation. Check cancellation, accumulation error, condition numbers, and operation ordering when there is a practical risk.
- An iterative algorithm must define a termination condition, iteration cap, convergence metric, and behavior when it does not converge.
- Approximation/optimization must return enough diagnostics for the caller to distinguish converged, partial, infeasible, cancelled, and failed outcomes.

## Randomized and Probabilistic Behavior

- The seed must be injectable and recorded in failure output. Regression tests use a fixed seed or counterexample.
- Separate deterministic correctness properties from statistical quality metrics.
- Statistical tests must have a sample size and acceptance threshold derived from requirements; avoid thresholds so close to noise that tests become flaky.
- For heuristics, compare quality/cost on representative and adversarial datasets; do not report only the best case or an average without a distribution.

## Appropriate Oracles

- Use a simple, clear implementation for small inputs as a differential oracle when possible.
- Test identities, bounds, conservation laws, monotonicity, symmetry, or metamorphic relations independently of the implementation.
- Preserve instability cases, non-convergence cases, or failure-inducing seeds as regression fixtures with clear provenance.
