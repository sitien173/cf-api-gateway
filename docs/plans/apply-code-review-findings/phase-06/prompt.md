## Original User Request

Apply every confirmed code-review correction through the approved phased plan.

## Phase

Verify release readiness.

## Tasks

- task-1: Run the complete release verification suite.
- task-2: Audit the original security, reliability, and edge-case findings.
- task-3: Verify README and CI deployment requirements.
- task-4: Obtain independent specification and quality reviews.

## Files

- `README.md`
- `.github/workflows/ci.yml`
- `src/`
- `test/`
- `docs/plans/apply-code-review-findings/phase-06/notes.md`
- `docs/plans/apply-code-review-findings/phase-06/journal.md`

## Done When

- Every original finding has current passing evidence.
- Fresh tests, type checks, audits, and bundling pass.
- No bundle artifact is tracked.
- CI covers the required verification commands.
- README documents both Auth0 deployment bindings.
- Independent reviews report no blocking findings.

## Rules

Follow the supplied worker contract. Change only defects found by verification. Maintain this phase's `notes.md` and `journal.md`.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
