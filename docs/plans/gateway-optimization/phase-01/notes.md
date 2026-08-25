# Phase 1 — Decision Notes

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
- RED -> GREEN: `cors response policy rejects insecure wildcard origins` failed because `http://evil.udemy.com` was echoed; after requiring HTTPS for suffix matches, `npm run check` passed (65 tests).
- Root cause (bugfix only): Wildcard matching validated only the hostname and ignored the request origin protocol.

## Task 2

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
- RED -> GREEN: `cors response policy varies on Origin when the origin does not match` failed with no `Vary` header; after appending it before the match branch, `npm run check` passed (66 tests).
- Root cause (bugfix only): `Vary: Origin` was appended only after a successful non-wildcard match.

## Task 3

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
- RED -> GREEN: `cors response policy echoes requested headers for credentialed wildcard headers` received `*` instead of the request header value; after echoing `Access-Control-Request-Headers`, `npm run check` passed (67 tests).
- Root cause (bugfix only): Credentialed wildcard request headers were emitted literally as `*`.

## Task 4

### Decisions made
- Validation runs over all configured policies before route compilation.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Schema validation supplies array-shaped `allowedOrigins`; compilation also guards malformed options with `Array.isArray`.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `compileGateway rejects credentialed wildcard CORS policies` initially reported a missing exception; after compile-time validation, `npm run check` passed (68 tests).
- Root cause (bugfix only): `compileGateway` had no validation for the invalid wildcard-plus-credentials combination.

## Task 5

### Decisions made
- CORS behavior coverage remains in the existing direct-handler test files; compile validation coverage is colocated with the CORS tests.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Added coverage for insecure wildcard rejection, explicit localhost development origins, non-matching `Vary: Origin`, credentialed request-header echo, and compile-time rejection. Final `npm run check` passed: 68 tests.
