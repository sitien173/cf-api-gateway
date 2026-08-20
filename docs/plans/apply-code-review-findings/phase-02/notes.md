<!-- ccg-shared-version: 10.0.3 -->

# Phase 2 — Decision Notes

## Task 1

### Decisions made
- Regression coverage asserts that gateway and origin log events expose only approved operational metadata.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Matched route templates are safe metadata because they come from gateway configuration rather than request URLs.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Updated gateway and origin logging tests first failed on existing `path`, query, header, `targetUrl`, and `errorMessage` fields; after the logging changes, all logging regressions pass.

## Task 2

### Decisions made
- Stable error categories remain the existing stage/outcome pairs, while raw error messages and request-derived fields are removed from `GatewayLogEvent`.
- Origin forwarding URLs remain internal variables but are never included in log-event construction.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Route templates and HTTP methods are sufficient for operational log correlation without exposing request paths or values.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Metadata-only gateway and origin tests pass; `npm run typecheck` passes; the forbidden-field audit finds no `targetUrl` or `errorMessage` log fields; `git diff --check` passes.

## Task 3

### Decisions made
- Added direct datapoint-layout coverage plus gateway integration coverage for matched responses and route misses.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- `route_miss` is the fixed route label for unmatched requests.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: New Analytics Engine tests initially failed because the old logger accepted a request/response and wrote no datapoints; they pass after switching to typed metadata events and datapoint writes.

## Task 4

### Decisions made
- Analytics receives only `{ routePath, method, status, latencyMs }` and writes the documented `indexes`, `blobs`, and `doubles` positions.
- Analytics remains deferred through `ctx.waitUntil`; response bodies are not cloned or read.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- The `API_ANALYTICS` binding is available when production analytics is enabled.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `npm test` passes all 16 tests, including exactly one datapoint per tested response and the fixed route-miss label. `npm run bundle` succeeds.
