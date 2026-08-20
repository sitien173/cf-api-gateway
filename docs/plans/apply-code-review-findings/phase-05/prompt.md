## Original User Request

Apply every confirmed code-review correction through the approved phased plan.

## Phase

Correct remaining reviewed types and edge cases.

## Tasks

- task-1: Add failing regression tests for validation, response, and method edge cases.
- task-2: Return HTTP 400 for all client JSON validation failures.
- task-3: Preserve request identity and merge JSON response headers.
- task-4: Tighten exposed types and correct reviewed naming defects.

## Files

- `src/helpers/response.ts`
- `src/policies/request/json-body-validation.ts`
- `src/policies/request/change-method.ts`
- `src/policies/request/basic-auth.ts`
- `src/types/index.ts`
- `src/gateway/types.ts`
- `src/gateway/compiler.ts`
- `src/gateway/runtime.ts`
- `test/gateway-pipeline.test.ts`
- `test/request-policies.test.ts`
- `test/response-helpers.test.ts`
- `docs/plans/apply-code-review-findings/phase-05/notes.md`
- `docs/plans/apply-code-review-findings/phase-05/journal.md`

## Done When

- Every JSON client-validation failure returns HTTP 400.
- JSON responses retain caller headers and content type.
- Method changes preserve authenticated identity.
- GET and HEAD method changes remove request bodies.
- Public source types expose no avoidable `any` values.
- Reviewed naming and spelling defects are corrected.
- `npm test`
- `npm run check`
- `npm run types:check`
- `npm audit --audit-level=high`
- `npm run bundle`
- `tgrep -n -e ': any' -e '<any>' src`
- `git diff --check`

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`. Use RED then GREEN and avoid unrelated formatting changes.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
