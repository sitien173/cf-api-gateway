# Phase 5 — Decision Notes

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
- RED -> GREEN: `basic authentication accepts case-insensitive and spaced schemes` rejected double-spaced Basic headers; after regex parsing, `npm run check` passed (83 tests).
- Root cause (bugfix only): Basic authentication split the header on a single literal space and compared the scheme case-sensitively.

## Task 2

### Decisions made
- The constant-time helper is shared from `auth0-jwt.ts`; API-key parsing is memoized by raw environment value.

### Spec deviations
- none

### Tradeoffs accepted
- The API-key memo is process-local and naturally resets with a new module instance.

### Assumptions
- Credential strings are compared as UTF-8 bytes and unequal lengths remain false after the full loop.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `constant-time comparison requires equal strings` initially found no helper; after adding the XOR-based comparison and API-key memo, `npm run check` passed (84 tests).

## Task 3

### Decisions made
- Schema details are emitted as structured error-log reasons while the client response remains generic.

### Spec deviations
- none

### Tradeoffs accepted
- Validation detail remains available to server logs but is no longer returned to callers.

### Assumptions
- Error logging is sufficient for operators to diagnose schema mismatches.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: JSON validation response exposed schema detail; after logging the detail and returning the generic message, `npm run check` passed (84 tests).

## Task 4

### Decisions made
- Added comments at the accepted LKG race and auth-optional route decision points.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Documentation-only changes; `npm run check` passed (84 tests).

## Task 5

### Decisions made
- Documented the API key alongside existing Worker secret setup commands.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Documentation-only change; `npm run check` passed (84 tests).

## Task 6

### Decisions made
- The unavailable gateway returns a minimal permissive CORS header set directly from its origin response.

### Spec deviations
- none

### Tradeoffs accepted
- Unavailable responses intentionally allow all origins because no configured gateway policy is available.

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: unavailable responses lacked `Access-Control-Allow-Origin`; after adding permissive CORS headers and documenting the constructed-Response contract, `npm run check` passed (85 tests).

## Task 7

### Decisions made
- Request URL resolution is shared by normal and preflight route lookup; background analytics still preserve rejected-promise behavior while calling the logger directly.

### Spec deviations
- none

### Tradeoffs accepted
- Sync analytics throws are converted to rejected background promises so they cannot change the response path.

### Assumptions
- Origin request construction with the original Request preserves its method, headers, and body safely.

### Follow-ups for human
- none

### Test evidence
- Existing routing, analytics, failover, and URL-origin tests stayed green after removing redundant allocations and the microtask wrapper; `npm run check` passed (85 tests).

## Task 8

### Decisions made
- Basic-auth and JSON validation assertions were updated in the existing request-policy suite.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Added coverage for Basic casing/spacing, constant-time comparison, generic validation responses, and unavailable-gateway CORS. Final `npm run check` passed: 85 tests.
