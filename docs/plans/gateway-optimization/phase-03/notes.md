# Phase 3 — Decision Notes

## Task 1

### Decisions made
- none

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `failover handlers dedupe concurrent health checks through one shared cache` observed two health requests; after moving the cache and lookup into `failover.ts` with in-flight sharing, `npm run check` passed (75 tests).
- Root cause (bugfix only): Each failover handler owned an independent settled-only health cache.

## Task 2

### Decisions made
- The shared parameterized implementation and location rewriting live in `failover.ts`; the two origin modules remain thin registry-compatible wrappers.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- `stripPrefix` being absent preserves the prior `upstreamWithFallback` location behavior.

### Follow-ups for human
- none

### Test evidence
- Characterization coverage for both origin names remained green during consolidation; `npm run check` passed (75 tests).

## Task 3

### Decisions made
- Retryable methods continue to use a buffered body representation, while non-retryable methods pass the original stream through once.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- GET and HEAD requests do not carry retry bodies; non-retryable request bodies are never replayed.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `non-retryable failover requests stream bodies with half duplex` returned 503 because the body was buffered; after forwarding `request.body` with `duplex: "half"`, `npm run check` passed (76 tests).
- Root cause (bugfix only): Failover eagerly called `request.arrayBuffer()` before deciding whether a retry was possible.

## Task 4

### Decisions made
- URL origin timeout defaults to 5000 ms and can be overridden with `options.timeout`.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- A timed-out or otherwise failed URL-origin fetch returns the existing 500 error response contract.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `url origin aborts timed out requests without following redirects` observed redirect mode `follow`; after adding an abort signal, timeout cleanup, and manual redirects, `npm run check` passed (77 tests).
- Root cause (bugfix only): URL-origin fetch had no abort signal or timeout and inherited redirect following.

## Task 5

### Decisions made
- Added focused tests to the existing failover and origin logging suites without changing the handler registry API.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Added coverage for shared concurrent health checks, streamed non-retryable bodies, configurable URL timeout, and manual redirects. Final `npm run check` passed: 77 tests.
