<!-- refract-shared-version: 1.2.0 -->

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
- RED -> GREEN: schema rejection test failed on `/x/*`; after the new schema pattern, schema/compiler/pipeline focused tests pass.

## Task 2

### Decisions made
- Kept regex-constructor errors wrapped with the route label and attached the original cause for lint compliance.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: compiler tests initially observed missing parsed metadata and no invalid-regex rejection; compiler mode parsing, duplicate detection, ordering, and regex flag tests now pass.

## Task 3

### Decisions made
- Track whether the highest-priority matching prefix has been found, so a shorter `^~` cannot override a longer plain prefix.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: pipeline selection initially showed a shorter `^~ /a/` incorrectly winning over `/a/b/c`; runtime now evaluates the longest prefix before regex search. Bundled route migration tests pass.

## Task 4

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
- RED -> GREEN: schema/compiler/pipeline tests cover all supported forms, invalid forms/regex, selection, preflight, config resolution, and raw analytics/log paths. `npm run lint`, `npm run check` (100 tests), `npm run types:check`, and `npm run bundle` pass.

## Fix 1

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
- RED -> GREEN: expanded schema test failed because `= /*` validated. Moved the wildcard lookahead before the slash; schema tests now reject `/*`, `= /*`, and `^~ /*`. Exact-route selection assertions and focused tests pass.
