## 1. Compile the gateway model

- [x] 1.1 Extract config compilation from `src/index.ts` into a typed gateway builder that resolves routes, origins, and request/response policy handlers once at startup.
- [x] 1.2 Replace the duplicated request/response policy map setup with shared compilation helpers and explicit configuration error handling for unknown handlers.

## 2. Extract the request pipeline

- [x] 2.1 Implement route resolution and request policy execution helpers that preserve configured ordering and support early `Response` short-circuiting.
- [x] 2.2 Implement origin invocation and response policy execution helpers so the worker entrypoint orchestrates the pipeline instead of owning all logic inline.
- [x] 2.3 Introduce a single response finalizer that computes latency, schedules analytics logging, and returns terminal responses for success, route miss, short-circuit, and failure paths.

## 3. Verify pipeline behavior

- [x] 3.1 Add focused tests or verification coverage for startup compilation failures, request policy short-circuiting, successful route execution, route misses, and unhandled failures.
- [x] 3.2 Run the project verification command set needed to confirm the refactored gateway still builds and that the new pipeline behavior matches the spec.
