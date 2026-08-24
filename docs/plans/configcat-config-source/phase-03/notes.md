<!-- ccg-shared-version: 10.0.3 -->

# Phase 3 — Decision Notes

<!--
Worker Notes template. Copy to docs/plans/<slug>/phase-<NN>/notes.md, fill the
heading, then append one `## Task <M>` block per task. Keep the file; never
overwrite earlier task blocks. Empty sub-sections = `- none`. Every task gets a
block even if all `none`.
-->

## Task 1

### Decisions made
- Kept resolver state in `createGatewayResolver` closure and created the ConfigCat client lazily from the request environment.

### Spec deviations
- none

### Tradeoffs accepted
- Used a five-second SDK request timeout to bound inline refreshes.

### Assumptions
- The injected `getClient` returns a synchronous `IConfigCatClient` as specified.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Test-first source tests initially failed because `src/config/source.ts` did not exist; after implementation, `npm run typecheck` passed and the full suite passed 57/57.
- Root cause (bugfix only): none

## Task 2

### Decisions made
- Processed each candidate through JSON parsing, Phase 1 schema validation, and `compileGateway` before adoption; candidate failures log their source and reason.

### Spec deviations
- none

### Tradeoffs accepted
- A non-string final candidate is serialized only for hashing/state while being validated as its original parsed value.

### Assumptions
- The caller-supplied final candidate is already parsed when supplied as an object.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Tests cover malformed ConfigCat values falling through to LKG, corrupt LKG falling through to inline refresh, all candidates failing, and adopted-source logging; `npm test` passes 57/57.
- Root cause (bugfix only): none

## Task 3

### Decisions made
- Used `ctx.waitUntil` only for warm refreshes, while cold callers await the shared in-flight ladder; successful and failed settles use jittered refresh and five-second backoff respectively.
- Clamped injected jitter to `[0, 1]` before applying the bounded 15-second ceiling.

### Spec deviations
- none

### Tradeoffs accepted
- The generation guard is retained even though the in-flight gate normally serializes refresh starts.

### Assumptions
- `ctx.waitUntil` accepts the resolver's promise and does not synchronously reject in production.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Tests cover warm no-I/O behavior, shared cold refreshes, five-second retry, and jitter bounds; `npm run typecheck` and `npm test` pass.
- Root cause (bugfix only): none

## Task 4

### Decisions made
- LKG writes occur only for the validated and compiled `inline-refresh` candidate; ConfigCat, LKG, and bundled candidates never write.
- Added optional resolver-specific log fields for source, hash, and rejection reason while making log method optional.

### Spec deviations
- none

### Tradeoffs accepted
- LKG write failures do not discard an otherwise valid fresh candidate because Phase 2 catches and logs the KV failure.

### Assumptions
- FNV-1a over JavaScript string code units is sufficient for a short deterministic log hash.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: Tests verify fresh inline LKG writes, no writes for KV/bundled candidates, and deterministic adopted-source/hash logs; final checks pass 57/57.
- Root cause (bugfix only): none
