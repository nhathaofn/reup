# Architecture Decision Matrix

Use these tables only when more than one placement remains plausible after inspecting the code. Structural placement and responsibility role are separate decisions.

## Structural location

| Signal | Existing owner | New function | New file/module | New package |
|---|---:|---:|---:|---:|
| Extends the same responsibility | Strong | Maybe | Weak | No |
| One small cohesive operation | Maybe | Strong | Weak | No |
| Several related functions/types | Weak | Maybe | Strong | Weak |
| Stable capability with several cohesive elements | Weak | Weak | Maybe | Strong |
| Needs a minimal boundary API | Weak | Weak | Maybe | Strong |
| Only reduces file length | Maybe | Weak | Avoid | Avoid |
| Would expose implementation details | Strong | Maybe | Weak | Avoid |
| Would introduce a dependency cycle | Reconsider | Reconsider | Reconsider | Reject proposed split |

## Responsibility role

| Signal | Plain behavior | Service role | Engine role |
|---|---:|---:|---:|
| One small operation | Strong | Avoid | Avoid |
| Coordinates repositories/providers | Weak | Strong | Weak |
| Owns an application use case | Weak | Strong | Weak |
| Coordinates durable transaction/state | Weak | Strong | No |
| Runs a complex transformation pipeline | Weak | Weak | Strong |
| Owns media/ML/rendering stages | Weak | Weak | Strong |
| Has processing-specific config/state | Maybe | Weak | Strong |
| Only forwards one call | Strong | Avoid | Avoid |

## Default rule

Choose the lowest-cost structure and the least specialized role that preserve cohesion, testability, dependency direction, and clear ownership. Do not optimize for hypothetical scale.
