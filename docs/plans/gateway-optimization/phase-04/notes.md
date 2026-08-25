# Phase 4 — Decision Notes

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
- RED -> GREEN: `emitGatewayLog suppresses info below the configured level` still delivered the info event at `GATEWAY_LOG_LEVEL=error`; after adding the environment-aware gate, `npm run check` passed (79 tests).
- Root cause (bugfix only): Logging had no configured-level filter.

## Task 2

### Decisions made
- Runtime and resolver logging use environment-aware logger wrappers; origin handlers retain only non-duplicate error/lifecycle logging, while runtime keeps origin start/completion events.

### Spec deviations
- none

### Tradeoffs accepted
- Existing pipeline expectations were updated to reflect removal of the redundant analytics scheduling event.

### Assumptions
- Errors remain emitted regardless of configured log level.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Existing origin and pipeline assertions reported duplicate URL-origin and analytics-scheduled events; after removing those logs, `npm run check` passed (79 tests).
- Root cause (bugfix only): URL origins logged the same origin lifecycle already logged by runtime, and analytics scheduling duplicated finalization logging.

## Task 3

### Decisions made
- A module-level `WeakMap` uses schema object identity as the validator cache key.

### Spec deviations
- none

### Tradeoffs accepted
- Invalid schemas are not cached because Validator construction must succeed first.

### Assumptions
- Compiled policy option/schema object identity remains stable across requests.

### Follow-ups for human
- none

### Test evidence
- Existing JSON validation behavior remained green after memoization; `npm run check` passed (79 tests).

## Task 4

### Decisions made
- Cold-start LKG writes are attached to the supplied execution context; warm refresh writes retain their awaited background-refresh lifecycle.

### Spec deviations
- none

### Tradeoffs accepted
- The cold resolver returns after candidate adoption while the scheduled write continues through `waitUntil`.

### Assumptions
- The Worker execution context keeps scheduled promises alive after the response path returns.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Cold inline-refresh initially had no pending context write; after scheduling `writeLkg` with `ctx.waitUntil`, updated resolver tests and `npm run check` passed (79 tests).

## Task 5

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
- RED -> GREEN: `readLkg uses the KV cache TTL` observed undefined options; after passing `{ cacheTtl: 60 }`, `npm run check` passed (80 tests).

## Task 6

### Decisions made
- The last-written map is instance-local and updates only after a successful KV put.

### Spec deviations
- none

### Tradeoffs accepted
- A new cache instance writes its first value even if another instance previously wrote identical bytes.

### Assumptions
- ConfigCat cache keys are scoped by gateway name before map lookup.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `ConfigCat cache skips byte-identical writes per key` counted four puts instead of three; after adding the per-key last-written guard, `npm run check` passed (81 tests).

## Task 7

### Decisions made
- Error reasons use the error message for Error instances and `String(error)` for non-Error throws.

### Spec deviations
- none

### Tradeoffs accepted
- The unavailable-gateway path logs resolver failures before returning its existing 503 response.

### Assumptions
- Error messages are safe diagnostic context for the structured log event.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Runtime failure logs initially lacked a reason; after capturing catch values and emitting reasons in runtime/index, `npm run check` passed (81 tests).

## Task 8

### Decisions made
- Coverage was added to the existing origin, KV, resolver, and gateway pipeline suites where each behavior is observable.

### Spec deviations
- none

### Tradeoffs accepted
- Existing tests outside the phase file shortlist were updated where removed log events were explicitly asserted.

### Assumptions
- none

### Follow-ups for human
- none

### Test evidence
- Added/updated tests for log gating, duplicate-log removal, cold-start scheduling, KV cache TTL and write skipping, and runtime error reasons. Final `npm run check` passed: 81 tests.
