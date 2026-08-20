## Original User Request

Apply every confirmed code-review correction through the approved phased plan.

## Phase

Require Auth0 JWT authentication on every mutation route.

## Tasks

- task-1: Add typed Auth0 Worker bindings and pass environment into request policies.
- task-2: Cache normalized remote JWK sets.
- task-3: Protect every unsafe configured method and reject unprotected mutation routes.
- task-4: Add Auth0 regression coverage while preserving public GET and OPTIONS.

## Context

Read `AUTH0_ISSUER` and `AUTH0_AUDIENCE` only from Worker bindings. Missing bindings return 500; missing or invalid tokens return 401. Valid tokens reach the selected origin. Treat GET, HEAD, and OPTIONS as public/safe. Compilation must reject every other configured method without Auth0 JWT. Do not commit deployment values.

## Files

- `src/types/index.ts`
- `src/gateway/types.ts`
- `src/gateway/runtime.ts`
- `src/gateway/compiler.ts`
- `src/policies/request/auth0-jwt.ts`
- `src/config.json`
- `src/index.ts`
- `worker-configuration.d.ts`
- `README.md`
- `test/gateway-pipeline.test.ts`
- `test/auth0-jwt.test.ts`
- `docs/plans/apply-code-review-findings/phase-04/notes.md`
- `docs/plans/apply-code-review-findings/phase-04/journal.md`

## Done When

- Missing Auth0 bindings return HTTP 500.
- Missing or invalid tokens return HTTP 401.
- Valid tokens reach the selected origin.
- Remote JWK sets persist across requests.
- Every unsafe configured method uses Auth0 JWT.
- Compilation rejects unprotected mutation routes.
- GET routes remain public.
- OPTIONS preflight remains unauthenticated.
- `npm test`
- `npm run typecheck`
- `npm run types:check`
- `npm run bundle`
- `tgrep -n '"request": \[\]' src/config.json`
- `git diff --check`

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`. Use RED then GREEN. Never log bearer tokens or commit Auth0 deployment values.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
