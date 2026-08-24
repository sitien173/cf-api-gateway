<!-- ccg-shared-version: 10.0.3 -->

# Phase 2 — Decision Notes

<!--
Worker Notes template. Copy to docs/plans/<slug>/phase-<NN>/notes.md, fill the
heading, then append one `## Task <M>` block per task. Keep the file; never
overwrite earlier task blocks. Empty sub-sections = `- none`. Every task gets a
block even if all `none`.
-->

## Task 1

### Decisions made
- Added `@configcat/sdk` as a runtime dependency at the requested `^1.1.0` range.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: The test-first adapter suite initially failed because `src/config/kv.ts` did not exist; dependency installation updated `package.json` and `package-lock.json`, and the final verification passed.
- Root cause (bugfix only): none

## Task 2

### Decisions made
- Key helpers require a non-empty `GATEWAY_NAME` and preserve the SDK-provided cache key after the `cc:<gatewayName>:` prefix.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Tests cover missing names, empty names, exact prefixes, and disjoint keys; `npm run typecheck` passed and `npm test` passed all 48 tests.
- Root cause (bugfix only): none

## Task 3

### Decisions made
- Implemented `GatewayConfigCatCache` with dependency-injected KV and a factory returning `IConfigCatCache`.
- KV failures are logged and converted to safe cache results rather than rejected promises.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: The cache test verifies scoped SDK keys and `{ cacheTtl: 60 }`; full typecheck and test verification passed (48/48).
- Root cause (bugfix only): none

## Task 4

### Decisions made
- Stored LKG values use a versioned `{ version, raw, timestamp }` envelope with epoch-millisecond timestamps.
- Legacy, malformed, or non-envelope values are returned as raw documents with timestamp `0`; missing values return `null`.
- `writeLkg` accepts `Date` or epoch milliseconds and returns whether it wrote.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- A missing ConfigCat fetch timestamp is not eligible for an LKG write.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Tests cover missing, legacy, corrupt, versioned, stale/equal, and rejected-write cases; `npm run typecheck` passed and `npm test` passed all 48 tests.
- Root cause (bugfix only): none
