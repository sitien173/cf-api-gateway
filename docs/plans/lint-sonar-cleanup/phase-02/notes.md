<!-- refract-shared-version: 1.2.0 -->

# Phase 2 — Decision Notes

## Task 1

### Decisions made
- Made request, response, and origin handler aliases generic with `unknown` defaults and used method-signature indexed types so differently typed options remain assignable in heterogeneous registries without `any`.
- Typed change-method, basic-auth, JSON validation, CORS, add-headers, URL, and failover origin handlers with their options types.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- `npm run typecheck` passed after handler types and compiler integration were updated.

## Task 2

### Decisions made
- Used `unknown` for environment and option boundaries, omitted the unnecessary logging environment index signature, and narrowly typed the optional handler compilation hook.

### Spec deviations
- none

### Tradeoffs accepted
- The handler aliases use bivariant method signatures to preserve heterogeneous registry assignment without `any` or lint suppressions.

### Assumptions
- The environment fields accessed by this implementation are explicitly declared; dynamic environment indexing is not required.

### Follow-ups for human
- none

### Test evidence
- `npm run typecheck` passed with the typed gateway/compiler/logging boundaries.

## Task 3

### Decisions made
- Removed test casts to `any`; retained an `unknown as object` assertion for the intentionally invalid null schema fixture.
- Updated the log-event test expectation to include the required event fields now that its cast was removed.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Initial `npm run check` caught the now-complete log-event shape in the test's expected value; updated the assertion and re-ran successfully.
- `npx eslint .` exited 0 with no output.
- `grep -rn "eslint-disable" src test` and `grep -Rn "as unknown as" src` produced no matches.
- `npm run check` passed (typecheck and all 91 tests).
- `npm run bundle` passed.
