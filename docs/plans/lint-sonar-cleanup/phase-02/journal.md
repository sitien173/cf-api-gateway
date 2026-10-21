<!-- refract-shared-version: 1.2.0 -->

# Phase 2 — Journal: Replace any with generic handler types

<!--
Phase Journal template. Copy to docs/plans/lint-sonar-cleanup/phase-02/journal.md at phase
start, fill the META, then append the full `# EXTERNAL RESPONSE` block (see
erp.md) under `## Implementation Response` after all tasks. Never overwrite earlier
sections.
-->

## META

- Plan: docs/plans/lint-sonar-cleanup/PLAN.md
- Implementation Profile: implement
- Consultation Profile: n/a
- Review Profile: review
- Implementation Job: ff05048d-fcc9-4112-bc08-ab4f0e59912d
- Review Job: 273944c2-5f04-453c-b3e5-d2d3ba5bce8c
- Started: 2026-10-21T14:16:32+07:00
- Finished: 2026-10-21T14:16:32+07:00

## Implementation Response

# EXTERNAL RESPONSE
## META
- Phase 2 / Started 2026-10-21T14:16:32+07:00 / Finished 2026-10-21T14:16:32+07:00 / Plan dir docs/plans/lint-sonar-cleanup
## SUMMARY
Removed explicit `any` types through generic handler options, unknown-typed boundaries, and typed test fixtures without changing runtime behavior.
## FILES MODIFIED
| Action | Path | Change |
|---|---|---|
| Modified | src/types/index.ts | Added generic handler option types and replaced `any` boundaries with `unknown`. |
| Modified | src/gateway/types.ts | Replaced `any` fields and generalized handler configuration. |
| Modified | src/gateway/compiler.ts | Removed `any` from policy resolution and narrowed the compile hook. |
| Modified | src/gateway/logging.ts | Removed `any` from the logging environment type. |
| Modified | src/index.ts | Changed the environment index signature from `any` to `unknown`. |
| Modified | src/policies/request/basic-auth.ts | Applied the policy's options type to its handler. |
| Modified | src/policies/request/change-method.ts | Applied the policy's options type to its handler. |
| Modified | src/policies/request/json-body-validation.ts | Applied generic schema options to the handler and compile hook. |
| Modified | src/policies/response/add-headers.ts | Applied the policy's options type to its handler. |
| Modified | src/policies/response/cors.ts | Applied the policy's options type to its handler. |
| Modified | src/origins/url.ts | Applied URL options to the origin handler. |
| Modified | src/origins/proxyAll.ts | Applied failover origin options to the handler. |
| Modified | src/origins/upstreamWithFallback.ts | Applied failover origin options to the handler. |
| Modified | src/origins/failover.ts | Exported the failover origin options type for typed handlers. |
| Modified | test/gateway-pipeline.test.ts | Removed `any` from handler and environment fixtures. |
| Modified | test/origin-logging.test.ts | Removed `any` from event and origin option fixtures. |
| Modified | test/request-policies.test.ts | Replaced the explicit `any` schema cast. |
| Modified | test/response-cors.test.ts | Removed the CORS options `any` cast. |
| Modified | docs/plans/lint-sonar-cleanup/phase-02/notes.md | Recorded decisions and verification evidence. |
| Modified | docs/plans/lint-sonar-cleanup/phase-02/journal.md | Recorded implementation response and phase metadata. |
## NOTES
- phase-02/notes.md (## Task 1, ## Task 2, ## Task 3)
## SPEC COMPLIANCE
- Meets Spec? YES — ESLint, typecheck/tests, bundle, and explicit cast/suppression checks passed.
## CLARIFICATIONS NEEDED
None
## NEXT
TASK_COMPLETE

## Quality Review

# CODE QUALITY REVIEW
- Status: PASS
- Findings: None.
- Scope checked: src/types/index.ts, src/gateway/types.ts, src/gateway/compiler.ts, src/gateway/logging.ts, src/index.ts, src/origins/*.ts, src/policies/**/*.ts, test/ edits

Coordinator note: the reviewer returned quickly without detail, so the Coordinator independently confirmed that `src/config/schema.ts` requires origin and policy `options` to be `{ type: "object" }`, which matches the narrowed `Record<string, unknown>` type. The implementer used the method-signature bivariance pattern instead of eslint-disable comments; zero disables remain.

Coordinator evidence at ab04198: `npx eslint .` exit 0; `npm run check` 91/91 pass; `npm run bundle` exit 0; `grep -rn eslint-disable src test` no matches.

<!-- Coordinator appends the independent review response here. -->

## Review Result

- Spec Status: PASS
- Quality Status: PASS
- Debt: none

## Final Checkpoint

- Phase base ref: refs/plans/lint-sonar-cleanup/phase-02/base
- Phase implementation ref: refs/plans/lint-sonar-cleanup/phase-02/impl
- Plan commit ref: refs/plans/lint-sonar-cleanup/impl or `pending`
- State checkpoint: temporary commit, or `n/a (untracked)` when plan artifacts
  are excluded

Phase refs retain review evidence after checkpoint consolidation. The plan ref
names the sole commit retained on the branch.
