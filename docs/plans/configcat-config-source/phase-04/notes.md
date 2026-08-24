<!-- ccg-shared-version: 10.1.0 -->

# Phase 4 - Decision Notes

<!-- Worker appends one task block per completed task. -->

## Task 1

### Decisions made
- Created one module-scope resolver instance and await it per request, passing the imported `config.json` as the final candidate.

### Spec deviations
- none

### Tradeoffs accepted
- Added a small exported unavailable-gateway factory so the 503 path can reuse `executeGatewayRequest` finalization and be regression-tested without network mocking.

### Assumptions
- ConfigCat secrets are provisioned externally and therefore do not belong in `wrangler.toml`.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: The new 503 regression initially failed because `createUnavailableGateway` was not yet wired; after implementation, `npm test` passed all 60 tests.
- Root cause (bugfix only): none

## Task 2

### Decisions made
- Resolution failure uses a synthetic exact-match compiled route whose origin returns `ErrorResponse` 503, allowing the existing request finalization, analytics, and logging path to run.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- The incoming request method and pathname are sufficient to construct the unavailable route.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: The regression asserts status 503, one analytics event, and the finalization log event; `npm test` passed 60/60.
- Root cause (bugfix only): none

## Task 3

### Decisions made
- Added `CONFIGCAT_SDK_KEY` as an optional secret binding type and `GATEWAY_CONFIG` as the required KV binding type; configured the supplied KV namespace ID.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- `CONFIGCAT_SDK_KEY` is supplied with Wrangler secret management rather than committed configuration.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `npm run typecheck` passed and `npm run bundle` reported the configured `GATEWAY_CONFIG` KV binding successfully.
- Root cause (bugfix only): none

## Task 4

### Decisions made
- Added `.dev.vars` to `.gitignore` and kept the bundled `src/config.json` import unchanged.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `npm run typecheck`, `npm test`, and `npm run bundle` all pass; the full suite reports 60 passing tests.
- Root cause (bugfix only): none

## Task 5

### Decisions made
- Normalized unresolved `OPTIONS` requests to a non-preflight execution request only within the unavailable-response helper, then restored the original method in analytics and log events.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- The unavailable path has no request or response policies and therefore does not need the original request body.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: The regression now exercises an unresolved `OPTIONS` request and asserts 503, analytics, and finalization logging; `npm run typecheck`, `npm test`, and `npm run bundle` pass.
- Root cause (bugfix only): Runtime handles all `OPTIONS` routes as successful 204 preflights before their origin executes.
