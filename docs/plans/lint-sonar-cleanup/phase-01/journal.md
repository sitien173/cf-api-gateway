<!-- refract-shared-version: 1.2.0 -->

# Phase 1 — Journal: Lint config, mechanical lint fixes, and Sonar fixes

<!--
Phase Journal template. Copy to docs/plans/lint-sonar-cleanup/phase-01/journal.md at phase
start, fill the META, then append the full `# EXTERNAL RESPONSE` block (see
erp.md) under `## Implementation Response` after all tasks. Never overwrite earlier
sections.
-->

## META

- Plan: docs/plans/lint-sonar-cleanup/PLAN.md
- Implementation Profile: implement
- Consultation Profile: n/a
- Review Profile: review
- Implementation Job: fdfd846c-e473-4ec9-ab13-0c0afd34a823
- Review Job: 10741243-a63b-4684-8a93-dc4aa0216e10 (first attempt dd05a0fd-e9f7-4200-ba67-bc02c320dd99 exhausted tool budget, no findings on code)
- Started: 2026-10-21T14:05:56+07:00
- Finished: 2026-10-21T14:05:56+07:00

## Implementation Response

# EXTERNAL RESPONSE
## META
- Phase 1 / Started 2026-10-21T14:05:56+07:00 / Finished 2026-10-21T14:05:56+07:00 / Plan dir docs/plans/lint-sonar-cleanup
## SUMMARY
Configured linting and CI enforcement, resolved Phase 1 lint findings, and fixed the specified SonarQube issues.
## FILES MODIFIED
| Action | Path | Change |
|---|---|---|
| Modified | eslint.config.mjs | Added build/generated ignores and underscore unused-variable patterns. |
| Modified | package.json | Added the `lint` script. |
| Modified | .github/workflows/ci.yml | Added lint CI step before checks. |
| Modified | src/config/source.ts | Used Web Crypto jitter and simplified refresh promise handling. |
| Modified | src/gateway/runtime.ts | Removed useless preflight initialization. |
| Modified | src/index.ts | Removed unused import and replaced parameter default with local fallback. |
| Modified | src/origins/url.ts | Removed unused catch binding. |
| Modified | src/policies/request/json-body-validation.ts | Removed unused catch binding. |
| Modified | src/policies/request/auth0-jwt.ts | Removed trailing-slash regex. |
| Modified | test/config-source.test.ts | Changed one-time assignment to `const`. |
| Modified | test/auth0-jwt.test.ts | Added multiple-trailing-slashes issuer test. |
| Modified | docs/plans/lint-sonar-cleanup/phase-01/notes.md | Recorded decisions and verification evidence. |
| Modified | docs/plans/lint-sonar-cleanup/phase-01/journal.md | Recorded implementation response and phase metadata. |
## NOTES
- phase-01/notes.md (## Task 1, ## Task 2, ## Task 3)
## SPEC COMPLIANCE
- Meets Spec? YES — All specified implementation changes and verification checks completed.
## CLARIFICATIONS NEEDED
None
## NEXT
TASK_COMPLETE

## Quality Review

# CODE QUALITY REVIEW
- Status: PASS
- Findings: None.
- Scope checked: eslint.config.mjs, package.json, .github/workflows/ci.yml, src/config/source.ts, src/gateway/runtime.ts, src/index.ts, src/origins/url.ts, src/policies/request/json-body-validation.ts, src/policies/request/auth0-jwt.ts, test/auth0-jwt.test.ts, test/config-source.test.ts

Coordinator note: implementer removed the redundant `refreshInFlight === refreshPromise` guard in `startRefresh`. Coordinator and reviewer confirmed no interleaving can differ, because `resolve` calls `startRefresh` only when `refreshInFlight` is unset, with no intervening await.

Coordinator evidence at b8ed23c: `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'` exit 0; `npm run check` 91/91 pass; `npm run bundle` exit 0.

<!-- Coordinator appends the independent review response here. -->

## Review Result

- Spec Status: PASS
- Quality Status: PASS
- Debt: none

## Final Checkpoint

- Phase base ref: refs/plans/lint-sonar-cleanup/phase-01/base
- Phase implementation ref: refs/plans/lint-sonar-cleanup/phase-01/impl
- Plan commit ref: refs/plans/lint-sonar-cleanup/impl or `pending`
- State checkpoint: temporary commit, or `n/a (untracked)` when plan artifacts
  are excluded

Phase refs retain review evidence after checkpoint consolidation. The plan ref
names the sole commit retained on the branch.
