## Original User Request
Apply the 27 cf-api-gateway optimization findings. Phase 3 of 5 consolidates the failover origins and fixes origin performance A1, P1, P4, C6.

## Phase
One shared failover origin with no blocking health checks and streaming bodies.

## Tasks
- task-1: Extract the shared health cache and health-status lookup into one module with in-flight promise dedupe and stale-while-revalidate serving.
- task-2: Merge the two handlers into one parameterized implementation; keep both exported names as thin wrappers so the handler registry is unchanged.
- task-3: In `failover.ts`, read the body only when `canRetry` is true; for streaming paths pass `request.body` with `duplex: "half"` to the upstream request.
- task-4: Add timeout and `redirect: "manual"` to the `url` origin fetch.
- task-5: Update tests for the shared cache, streaming non-retryable bodies, and the url timeout behavior.

## Context
Current behavior:

`src/origins/proxyAll.ts` (180 lines) and `src/origins/upstreamWithFallback.ts` (170 lines) are near-identical. Each has its own module-level `healthCache` Map, byte-identical `getHealthStatus`, near-identical `rewriteLocation`, identical `wrapResponse`, and identical `executeFailover` lifecycle callbacks differing only in `originType`. The only genuine behavioral difference is `stripPrefix` handling in `proxyAll` (`:94-99` and the relative-path branch at `:33-36`).

Health checking: `getHealthStatus` stores only settled results. Concurrent cold-start requests each fire their own `checkUpstreamHealth` subrequest, and the check is `await`ed before the upstream fetch with default 5000 ms timeout.

`src/origins/failover.ts` — `readRequestBody` buffers the entire body for every non-GET/HEAD request, even though `canRetry` only returns true for GET/HEAD, so POST/PUT/DELETE bodies are buffered and never used for retry.

`src/origins/url.ts` — `fetch(originRequest.url, originRequest)` has no timeout and follows redirects. `new Request(buildOriginUrl(...), new Request(request))` clones the request twice.

Tests: `test/origin-failover.test.ts` and `test/origin-logging.test.ts` exercise both origin handlers.

## Files
- `src/origins/proxyAll.ts`
- `src/origins/upstreamWithFallback.ts`
- `src/origins/failover.ts`
- `src/origins/url.ts`
- `src/origins/index.ts`
- `test/origin-failover.test.ts`
- `test/origin-logging.test.ts`

## Done When
- `proxyAll` and `upstreamWithFallback` share one health cache instance.
- Concurrent cold-start requests fire one health check, not one each.
- POST/PUT/DELETE bodies are streamed, not fully buffered.
- GET/HEAD retry behavior is unchanged.
- `url` origin aborts after its timeout and does not follow redirects.
- `npm run check` passes.

## Rules
Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
