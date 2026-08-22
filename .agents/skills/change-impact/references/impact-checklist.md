# Change Impact Checklist

Read only the rows relevant to the current change. These are search targets, not a requirement to modify every location.

| Change trigger | Inspect together |
|---|---|
| Go function/type signature | Callers, interfaces, implementations, constructors/composition, error handling, tests, exported documentation |
| TypeScript export/type | Imports, re-exports, consumers, window/global typings, event bindings, tests |
| Rename or move | Imports, string-based registration, route/channel names, config references, docs/examples, old-path search |
| HTTP route/method | Go route registration and handler, middleware/CORS/auth, client URL builder, caller, tests, docs |
| Request/response field | Server DTO and validation, serialization tags, client runtime validation/type, UI state/error mapping, fixtures |
| Error/status semantics | HTTP/IPC mapping, retry/idempotency policy, logs, durable status, UI feedback, tests |
| Electron IPC/preload API | Channel owner/constants, main handler, input validation, preload bridge, window typings, renderer consumer, listener disposal |
| Environment/config key | Loader, default, validation, `.env.example`, README/deployment input, client/server consumers, tests |
| Database/storage schema | Migration, model, query/repository, transaction, seed/fixture, compatibility/rollback, API serialization |
| File/media format | Reader, writer, version detection, validation, temporary files, cleanup, real-format fixture, downstream consumer |
| UI selector/data attribute | Markup producer, query selector, delegated/direct event handler, rerender lifecycle, accessibility, UI test |
| Shared style/token/variant | All consumers, responsive states, focus/disabled/error states, visual verification |
| Job/progress/cancellation | Service state transition, Engine cancellation, persistence, IPC/API event, renderer cleanup, retry/restart behavior |
| Public package API | External callers, exported names, adapters, compatibility, docs, import-cycle check |

## Search strategy

- Search exact identifiers first, then related literals such as route paths, JSON field names, environment keys, IPC channel names, selectors, and error/status values.
- Search definitions and consumers separately when a generic word would produce noise.
- Inspect code that constructs or registers an object even when it does not reference the edited method directly.
- After editing, search for both the old and new forms to catch stale consumers and accidental duplicates.

## Completion questions

- Did every changed contract update both producer and consumer?
- Did a default, example, fixture, or migration retain the old shape?
- Did error, cancellation, loading, or disabled behavior change indirectly?
- Did a rename leave string-based references behind?
- Did the change cross a runtime/security boundary that needs separate validation?
- Is a discovered related location intentionally compatible, or was it simply skipped?
