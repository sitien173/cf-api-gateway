<!-- ccg-shared-version: 10.0.3 -->

# Phase 3 — Decision Notes

## Task 1

### Decisions made
- Added mutation non-replay coverage for both public failover handlers across primary 5xx and transport-failure scenarios.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- A mutation primary 5xx response must be returned unchanged rather than treated as a retryable transport failure.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: New proxyAll and upstreamWithFallback mutation tests initially observed fallback requests; the shared executor now returns the primary 5xx or a 503 without replaying the mutation.

## Task 2

### Decisions made
- Added `src/origins/failover.ts` for shared health checking, request construction, response wrapping, retry selection, and 503 handling.
- Kept path construction, redirect rewrite callbacks, defaults, and health caches in each wrapper.

### Spec deviations
- none

### Tradeoffs accepted
- Lifecycle callbacks keep existing structured origin events without duplicating failover control flow.

### Assumptions
- Wrapper response callbacks own only response rewriting; transport decisions remain in the shared executor.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Existing origin logging and new failover tests pass after both public exports use the shared executor.

## Task 3

### Decisions made
- Only GET and HEAD retry after a healthy-primary 5xx or transport failure; all mutation methods preserve primary failures or return 503.
- An unhealthy primary selects fallback directly, so mutations receive one attempt.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Reusing one buffered request body for the single GET/HEAD retry is safe; mutation bodies are never retried.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Method matrix covers GET, HEAD, POST, PUT, PATCH, and DELETE for both handlers; all expected retry and non-replay outcomes pass.

## Task 4

### Decisions made
- Health-check timeout cleanup is centralized in `finally`.
- Every health and upstream request uses manual redirects; abandoned primary retry responses are canceled before fallback.
- Response wrapping occurs outside fetch catches so rewrite failures cannot trigger transport failover.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- A response body cancellation may complete asynchronously before the fallback fetch begins.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Timer cleanup, manual redirect, unhealthy-primary routing, and response-rewrite isolation regressions pass. Final verification: 23 tests pass, typecheck passes, bundle succeeds, and `git diff --check` passes.
