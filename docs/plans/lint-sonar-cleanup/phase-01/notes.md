<!-- refract-shared-version: 1.2.0 -->

# Phase 1 — Decision Notes

## Task 1

### Decisions made
- Configure unused-variable underscore exemptions within the TypeScript ESLint rule and add a dedicated global-ignore config entry.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- The configured flat-config ignores apply globally, excluding generated output from linting.

### Follow-ups for human
- none

### Test evidence
- `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'` exited 0 with no output.

## Task 2

### Decisions made
- Remove unused bindings and imports directly; use optional catch bindings where caught errors were not consumed.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'` exited 0 with no output; TypeScript and tests passed via `npm run check`.

## Task 3

### Decisions made
- Use the Worker Web Crypto API for default jitter randomness, and trim issuer trailing slashes iteratively while preserving the root pathname.
- Remove the object parameter initializer and apply the same analytics default inside `executeUnavailableRequest`.
- Clear the active refresh promise in `finally`; the resolver's single-flight flow ensures another refresh cannot replace it while this promise remains active.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Added the several-trailing-slashes issuer acceptance test; it passed against existing behavior as characterization coverage before the normalization refactor, then remained green.
- `npm run check` passed (typecheck and 91 tests).
- `npm run bundle` passed.
- `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'` exited 0 with no output.
