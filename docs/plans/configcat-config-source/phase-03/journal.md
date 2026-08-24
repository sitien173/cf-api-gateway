<!-- ccg-shared-version: 10.0.3 -->

# Phase 3 — Journal: Gateway resolution state machine

<!--
Phase Journal template. Copy to docs/plans/<slug>/phase-<NN>/journal.md at phase
start, fill the META, then append the full `# EXTERNAL RESPONSE` block (see
erp.md) under `## Implementation Response` after all tasks. Never overwrite earlier
sections.
-->

## META

- Plan: docs/plans/configcat-config-source/PLAN.md
- Implementation Profile: openai
- Consultation Profile: consult (plan-level, job 17a37b05-8802-4451-bf87-a22247cc9294)
- Review Profile: review
- Implementation Job: pending
- Review Job: pending
- Started: 2026-08-24
- Finished: 2026-08-24T11:47:29+07:00

## Implementation Response

# EXTERNAL RESPONSE
## META
- Phase 3 / Started 2026-08-24 / Finished 2026-08-24T11:40:09+07:00 / Plan dir docs/plans/configcat-config-source
## SUMMARY
Implemented the isolate-local gateway resolver with ordered candidate fallback, refresh gating, generation protection, and fresh-refresh LKG persistence.
## FILES MODIFIED
| Action | Path | Change |
|---|---|---|
| Created | src/config/source.ts | Added resolver state, candidate ladder, refresh gate, adoption logging, and LKG write qualification. |
| Created | test/config-source.test.ts | Added resolver, fallback, concurrency, backoff, jitter, and logging tests. |
| Modified | src/gateway/types.ts | Added resolver log fields and made log method optional. |
| Updated | docs/plans/configcat-config-source/phase-03/notes.md | Recorded task decisions and RED-to-GREEN evidence. |
| Updated | docs/plans/configcat-config-source/phase-03/journal.md | Recorded implementation response and completion metadata. |
## NOTES
- phase-03/notes.md (## Task 1, ## Task 2, ## Task 3, ## Task 4)
## SPEC COMPLIANCE
- Meets Spec? YES — Typecheck and all 57 tests pass; Phase 4 wiring remains untouched.
## CLARIFICATIONS NEEDED
None
## NEXT
TASK_COMPLETE

# EXTERNAL RESPONSE
## META
- Phase 3 fix / Started 2026-08-24T11:46:29+07:00 / Finished 2026-08-24T11:47:29+07:00 / Plan dir docs/plans/configcat-config-source
## SUMMARY
Fixed cold failure backoff, removed dead generation and raw state, and added bundled-candidate single-flight coverage.
## FILES MODIFIED
| Action | Path | Change |
|---|---|---|
| Updated | src/config/source.ts | Applied backoff to cold failures regardless of compiled state and removed generation/`lastRaw` state. |
| Updated | test/config-source.test.ts | Added failure-window, single-flight adoption, and bundled no-write assertions. |
| Updated | docs/plans/configcat-config-source/phase-03/notes.md | Recorded Task 5 and the approved generation deviation. |
| Updated | docs/plans/configcat-config-source/phase-03/journal.md | Appended this fix response. |
## NOTES
- phase-03/notes.md (## Task 5)
## SPEC COMPLIANCE
- Meets Spec? YES — Review findings are fixed; generation removal is recorded as an approved deviation; both checks pass.
## CLARIFICATIONS NEEDED
None
## NEXT
TASK_COMPLETE

## Quality Review

Initial review, job `89315b3b-2d7b-426d-aa9f-f1ad5766c361`, range
`7bec2c4..b43ce55`:

# CODE QUALITY REVIEW
- Status: FAIL
- Findings:
  - HIGH, `src/config/source.ts:401`, cold failures ignore `nextRefreshMs` because the early-return requires `compiled`. After all candidates fail, every request reruns the ladder and `forceRefreshAsync` instead of observing the 5-second backoff. Return `compiled` (including `undefined`) whenever `now < nextRefreshMs`.
  - MEDIUM, `src/config/source.ts:351-361`, `test/config-source.test.ts`, no stale-refresh test exists. The generation guard is unreachable: single-flight prevents a later refresh from starting until the earlier refresh reaches its `finally`. The gate does prevent stale adoption; remove the dead generation guard or redesign to permit superseding refreshes and test that behavior.
  - LOW, `src/config/source.ts:213,248`, `lastRaw` is write-only dead state; no required behavior consumes it. Remove it.
  - LOW, `test/config-source.test.ts:255`, the test titled "KV or bundled" only adopts the KV candidate; add a successful bundled-fallback case to verify it also does not write LKG.
- Scope checked: `src/config/source.ts`, `test/config-source.test.ts`, `src/gateway/types.ts`

Three of these four had already been raised by the coordinator's own spec pass
and were sent to the reviewer as explicit questions, so the review confirmed
them independently rather than discovering them alone. The reviewer added the
bundled-coverage finding.

Re-review of fix delta only, job `34208205-db0a-405f-b861-e381419781b8`, range
`b43ce55..173031a`:

# CODE QUALITY REVIEW
- Status: PASS
- Findings: none
- Scope checked: `src/config/source.ts`, `test/config-source.test.ts`

## Review Result

- Spec Status: PASS
- Quality Status: PASS
- Debt: none
- Fix cycles used: 1 of 2

## Approved plan deviation

PLAN.md Phase 3 task 3 and DESIGN.md both specify a `generation` counter, so
that a slow refresh completing after a newer one cannot overwrite the newer
`compiled`. The counter was implemented, then removed during the fix cycle.

The reason is that it was unreachable. `refreshInFlight` is cleared in a
`finally` that runs after the point where the generation would be compared, so a
later refresh cannot start until the earlier one has already settled and
adopted. Single-flight therefore already provides the exact property the counter
was meant to provide, and keeping both means keeping dead code.

The acceptance criterion "a refresh completing after a newer refresh does not
overwrite the newer `compiled`" is now satisfied by the single-flight gate, and
is verified by the test "single-flight warm refresh preserves the compiled
gateway until adoption", which asserts that a refresh in flight neither starts a
second refresh nor mutates `compiled` before it settles.

## Verification Evidence

Run fresh by the coordinator at `173031a`, tree clean:

- `npm run typecheck` — clean, no output from `tsc --noEmit`.
- `npm test` — 59 tests, 59 pass, 0 fail.

Coordinator-verified SDK facts used to write the phase prompt: `getClient`,
`PollingMode.ManualPoll`, `cache` and `requestTimeoutMs` client options,
`getValueDetailsAsync` returning `value`, `fetchTime`, and `isDefaultValue`, and
`forceRefreshAsync` returning a `RefreshResult` carrying `isSuccess` and
`errorMessage`. The Phase 2 carry-forward about `moduleResolution: "node"` is
closed: a root `@configcat/sdk` import typechecks, and a
`wrangler deploy --dry-run` of that import emitted `CloudflareConfigCache` and
the fetch-API fetcher with zero `node:http` references, confirming wrangler
applies the `workerd` export condition. No tsconfig change was needed.

## Final Commit

- Implementation: `b43ce55` feat(config): resolve gateway config from ConfigCat with KV fallback
- Fix: `173031a` fix(config): honor refresh backoff on cold failure and drop dead resolver state
- Phase base: `7bec2c4`
- State record: this journal update's commit
