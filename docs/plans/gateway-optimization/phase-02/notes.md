# Phase 2 — Decision Notes

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
- RED -> GREEN: `compileGateway normalizes route methods and rejects unknown methods` first observed compiled `get` instead of `GET`; after normalization and known-method validation, `npm run check` passed (69 tests).
- Root cause (bugfix only): Compiled routes retained authoring-case methods while runtime matching used exact comparison, and no compile-time method validation existed.

## Task 2

### Decisions made
- Prefix matching treats a trailing slash in normalized wildcard paths as the segment separator rather than requiring a doubled slash.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Prefix routes match the base segment and its descendants, but not sibling names such as `/apiary`.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `executeGatewayRequest keeps prefix routes within path segment boundaries` matched `/apiary/secret` and returned 200; after the segment-aware helper, `npm run check` passed (70 tests).
- Root cause (bugfix only): Runtime prefix resolution used raw `pathname.startsWith(route.path)`.

## Task 3

### Decisions made
- Ordering ties use path, method, and origin type as deterministic secondary keys after match mode and path length.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Routes with identical path, method, and origin type remain configuration-equivalent for resolution purposes.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `executeGatewayRequest resolves exact routes before broader prefixes` returned the prefix origin when configuration order put it first; after deterministic sorting, `npm run check` passed (71 tests).
- Root cause (bugfix only): Compiled routes were consumed in configuration order via `find`.

## Task 4

### Decisions made
- Preflight provenance is tracked locally from the result of `resolvePreflightRoute`; ordinary OPTIONS route matches remain normal origin requests.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- An OPTIONS request with a matching `Access-Control-Request-Method` is a preflight; without that match it may route explicitly to an OPTIONS origin.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `executeGatewayRequest routes explicit OPTIONS requests to their origin` received the unconditional 204 response; after gating the short-circuit on `isPreflight`, `npm run check` passed (72 tests).
- Root cause (bugfix only): Every matched OPTIONS request was short-circuited regardless of how it resolved.

## Task 5

### Decisions made
- Duplicate detection occurs while building policy definitions, before routes are compiled.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Policy names are the unique identifiers used by route policy references.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `compileGateway rejects duplicate policy names` initially reported a missing exception; after rejecting collisions, `npm run check` passed (73 tests).
- Root cause (bugfix only): `Map.set` silently replaced an earlier policy definition.

## Task 6

### Decisions made
- The all-or-nothing contract is documented immediately above `compileGateway`.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Documentation-only change; fresh `npm run check` passed (73 tests).

## Task 7

### Decisions made
- Tests remain colocated in `test/gateway-pipeline.test.ts`, covering compiler and runtime resolution through the public gateway API.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Added coverage for method normalization/validation, segment boundaries, deterministic exact-versus-prefix ordering, explicit OPTIONS routing alongside preflight behavior, and duplicate policy rejection. Final `npm run check` passed: 73 tests.
