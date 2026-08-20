## Original User Request

Apply every confirmed code-review correction through the approved phased plan.

## Phase

Remove sensitive telemetry and restore Analytics Engine writes.

## Tasks

- task-1: Add failing regression tests for metadata-only gateway and origin logs.
- task-2: Remove raw paths, query values, headers, target URLs, and unstable error details from logs.
- task-3: Add failing Analytics Engine datapoint tests.
- task-4: Write one typed Analytics Engine datapoint per response without reading response bodies.

## Context

`src/gateway/logging.ts` currently records request paths, queries, parameters, headers, and raw error messages. `src/gateway/runtime.ts` emits those fields through every lifecycle event. `src/services/analytics.ts` clones and reads response bodies but writes no Analytics Engine datapoints. Preserve the documented Analytics Engine column positions: `index1` gateway name, `blob1` matched route template, `blob2` method, `double1` status, and `double2` latency milliseconds. Route misses require one fixed route label. Analytics failures must remain background failures through `ctx.waitUntil`.

## Files

- `src/gateway/logging.ts`
- `src/gateway/runtime.ts`
- `src/gateway/types.ts`
- `src/services/analytics.ts`
- `src/index.ts`
- `test/gateway-pipeline.test.ts`
- `test/origin-logging.test.ts`
- `test/analytics.test.ts`
- `docs/plans/apply-code-review-findings/phase-02/notes.md`
- `docs/plans/apply-code-review-findings/phase-02/journal.md`

## Done When

- Logs contain no headers or query values.
- Logs contain no raw target URLs.
- Error logs expose stable categories only.
- Analytics writes exactly one datapoint per response.
- Datapoints preserve documented SQL positions.
- Analytics never clones or reads response bodies.
- Route misses use a fixed analytics route label.
- `npm test`
- `npm run typecheck`
- `npm run bundle`
- `tgrep -n -e 'query' -e 'params' -e 'headers' -e 'targetUrl' src/gateway src/origins src/services`
- `git diff --check`

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`. Use RED then GREEN for behavior changes. Do not change analytics SQL column positions or gateway execution behavior.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
