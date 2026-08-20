## Original User Request

Apply every confirmed code-review correction through the approved phased plan.

## Phase

Establish reproducible quality gates without changing runtime behavior.

## Tasks

- task-1: Add `tsx` and update Wrangler safely.
- task-2: Add `test`, `typecheck`, and `check` scripts.
- task-3: Add CI compilation, tests, audit, and bundling.
- task-4: Remove tracked bundles and document generation.

## Context

Native Node cannot resolve the current TypeScript imports. Current `npm audit` reports high-severity development-tool findings through Wrangler. `wrangler.toml` deploys `src/index.ts`, so tracked `dist/` files are stale artifacts rather than deployment inputs. The confirmed design removes `dist/` from Git and generates dry-run bundles in CI or releases.

Context7 confirmed `/privatenumber/tsx` supports `tsx --test`. Resolve current official GitHub Actions versions through Context7 before writing CI configuration. Do not guess action versions.

## Files

- `package.json`
- `package-lock.json`
- `.gitignore`
- `README.md`
- `worker-configuration.d.ts`
- `.github/workflows/ci.yml`
- `dist/README.md`
- `dist/index.js`
- `dist/index.js.map`
- `docs/plans/apply-code-review-findings/phase-01/notes.md`
- `docs/plans/apply-code-review-findings/phase-01/journal.md`

## Done When

- `npm test` executes every committed test.
- `npm run check` type-checks source and runs tests.
- Full audit reports no high vulnerabilities.
- CI creates a dry-run bundle successfully.
- `dist/` contains no tracked files.
- README commands match package scripts.
- `npm ci`
- `npm run check`
- `npm run types:check`
- `npm audit --audit-level=high`
- `npm run bundle`
- `git ls-files dist`
- `git diff --check`

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`. Use RED then GREEN for the missing test command. Treat dependency, CI, documentation, and generated-artifact changes as configuration work.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
