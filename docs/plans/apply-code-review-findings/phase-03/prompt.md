## Original User Request

Apply every confirmed code-review correction through the approved phased plan.

## Phase

Make failover shared and safe for mutation requests.

## Tasks

- task-1: Add failing mutation non-replay regression tests for both failover exports.
- task-2: Extract one internal failover executor used by both origin handlers.
- task-3: Retry only GET and HEAD requests.
- task-4: Clear health-check timers and preserve manual redirects and wrapper paths.

## Context

`proxyAll` and `upstreamWithFallback` duplicate unsafe retry logic that reuses mutation request bodies. An unhealthy primary must select the fallback directly once. A primary transport failure or 5xx may retry only GET or HEAD once. A mutation transport failure returns 503, and a primary mutation response retains its original status. Both public handlers must preserve their signatures and wrapper-specific path behavior.

## Files

- `src/origins/failover.ts`
- `src/origins/proxyAll.ts`
- `src/origins/upstreamWithFallback.ts`
- `test/origin-logging.test.ts`
- `test/origin-failover.test.ts`
- `docs/plans/apply-code-review-findings/phase-03/notes.md`
- `docs/plans/apply-code-review-findings/phase-03/journal.md`

## Done When

- GET and HEAD can retry fallback once.
- POST, PUT, PATCH, and DELETE never retry.
- Unhealthy routing sends mutations to one fallback.
- Mutation transport failures return HTTP 503.
- Primary mutation responses preserve their status.
- Every timeout clears after every outcome.
- Redirect handling stays manual across branches.
- Both public origin exports retain their signatures.
- `npm test`
- `npm run typecheck`
- `npm run bundle`
- `tgrep -n -e 'setTimeout' -e 'clearTimeout' src/origins`
- `git diff --check`

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`. Use RED then GREEN for behavior changes. Do not change configured route semantics.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
