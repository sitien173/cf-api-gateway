# Lint and Sonar Cleanup Plan

**Design:** `docs/plans/lint-sonar-cleanup/DESIGN.md`
**Base:** `refs/plans/lint-sonar-cleanup/base` (119a96b)

**Commit:** `chore(lint): fix all ESLint and SonarQube issues and enforce lint in CI`

## Baseline

At base, `npm run check` and `npm run bundle` pass. `npx eslint .` fails with 262 problems. Phase 1 repairs the lint baseline except `no-explicit-any`, which Phase 2 owns.

### Phase 1: Lint config, mechanical lint fixes, and Sonar fixes

**Task Guide Input:** Non-UI repository implementation in TypeScript for a Cloudflare Worker. Configure ESLint ignores and the unused-vars pattern, add a lint script and CI step, fix every ESLint problem except `@typescript-eslint/no-explicit-any`, and fix SonarQube issues S2245, S8786 and S7737 per `docs/plans/lint-sonar-cleanup/DESIGN.md`. No runtime behavior change.
**Goal:** ESLint reports zero problems apart from `no-explicit-any`, and the three Sonar issues are resolved in code.
**Files:**
- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/config/source.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `src/index.ts`
- Modify: `src/origins/url.ts`
- Modify: `src/policies/request/json-body-validation.ts`
- Modify: `src/policies/request/auth0-jwt.ts`
- Modify: `test/config-source.test.ts`
- Modify: `test/config-schema.test.ts` only if the `_` ignore pattern does not cover the destructured names
- Modify: `test/auth0-jwt.test.ts`
- Out of scope, do not edit: `dist/**`, `worker-configuration.d.ts`, `wrangler.toml`, `.dev.vars`, `.env`, `sonar-project.properties`, any secret-bearing file.
**Tasks:**
1. In `eslint.config.mjs`, add a global ignores entry for `dist/`, `.wrangler/` and `worker-configuration.d.ts`. Configure `@typescript-eslint/no-unused-vars` with `argsIgnorePattern`, `varsIgnorePattern` and `destructuredArrayIgnorePattern` set to `^_`. Add `"lint": "eslint ."` to `package.json` scripts. Add a `Lint` step running `npm run lint` to `.github/workflows/ci.yml` before the test step.
2. Fix the remaining non-`any` problems: `prefer-const` at `src/config/source.ts:351` and `test/config-source.test.ts:411`. Fix `no-useless-assignment` at `src/gateway/runtime.ts:149` without changing control flow. Remove the unused `ErrorResponse` import in `src/index.ts`. Use `catch {` at `src/origins/url.ts:59` and `src/policies/request/json-body-validation.ts:31`.
3. S2245: in `getJitter` in `src/config/source.ts`, replace the `Math.random()` default with `crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32`. S8786: in `normalizeIssuer` in `src/policies/request/auth0-jwt.ts`, replace `.replace(/\/+$/, "")` with a loop or index scan that strips all trailing `/`. Add a test in `test/auth0-jwt.test.ts` showing an issuer with several trailing slashes normalizes to one trailing slash, if no test covers that yet. S7737: in `src/index.ts`, remove the object-literal default from `executeUnavailableRequest`'s `dependencies` parameter while keeping calls without that argument working.
**Acceptance Criteria:**
- `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'` exits 0 with no output.
- `npx eslint .` reports only `@typescript-eslint/no-explicit-any` problems.
- No new `eslint-disable` comments.
- `src/config/source.ts` no longer calls `Math.random`. `src/policies/request/auth0-jwt.ts` contains no regex on the issuer pathname. `src/index.ts` has no object-literal parameter default.
- `npm run check` and `npm run bundle` pass.
**Reviewer Checklist:**
- Jitter stays within `[0, REFRESH_JITTER_MS)` and the injected `random` still wins.
- Issuer normalization output is unchanged for `""`, `/`, `/a`, `/a/`, `/a///` paths.
- `executeUnavailableRequest` callers in `src/index.ts` and tests behave as before.
- The `runtime.ts` edit does not change when `isPreflight` is read.
- The CI lint step runs after `npm ci` and before tests.
**Verification Checks:**
- `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'`
- `npm run check`
- `npm run bundle`

### Phase 2: Replace `any` with generic handler types

**Task Guide Input:** Non-UI repository implementation in TypeScript 4.9 under `strict`. Remove every `@typescript-eslint/no-explicit-any` problem by making handler types generic on their options type per decision 3 in `docs/plans/lint-sonar-cleanup/DESIGN.md`. Type-only refactor with no runtime change.
**Goal:** `npx eslint .` exits 0 and every remaining `any` is a documented registry boundary.
**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `src/gateway/logging.ts`
- Modify: `src/index.ts`
- Modify: `src/policies/**` and `src/origins/**` only where a handler's declared type must change to the new generic form
- Modify: `test/gateway-pipeline.test.ts`
- Modify: `test/origin-logging.test.ts`
- Modify: `test/request-policies.test.ts`
- Modify: `test/response-cors.test.ts`
- Out of scope, do not edit: `dist/**`, `worker-configuration.d.ts`, `eslint.config.mjs`, `wrangler.toml`, `.dev.vars`, `.env`, any secret-bearing file.
**Tasks:**
1. In `src/types/index.ts`, make `TRequestPolicyHandler`, `TResponsePolicyHandler`, `TOriginHandler`, `TRequestPolicy` and `TResponsePolicy` generic on `TOptions` with default `unknown`. Change `RequestPolicyEnv`'s index signature to `unknown`. Update handlers in `src/policies/**` and `src/origins/**` to use their own options type as the type argument.
2. In `src/gateway/types.ts`, `src/gateway/compiler.ts`, `src/gateway/logging.ts` and `src/index.ts`, replace `any` with `unknown` or a concrete type. Where a container must hold handlers with different options types, keep `any` only with one `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>` per site.
3. Replace the 10 `any` sites in the four test files with concrete types, `unknown`, or typed casts.
**Acceptance Criteria:**
- `npx eslint .` exits 0 with no output.
- Every `eslint-disable` comment in `src/` and `test/` names `@typescript-eslint/no-explicit-any` and carries a `--` reason. `grep -rn "eslint-disable" src test` lists at most 4 lines.
- No emitted JavaScript change beyond type erasure: `npm run bundle` passes.
- `npm run check` passes.
**Reviewer Checklist:**
- No `as unknown as` double casts in `src/` that hide a real type mismatch.
- Handler options types still match what the compiler passes from `PolicyConfig.options` and `OriginConfig.options`.
- `Env` and `RequestPolicyEnv` index-signature changes do not force unsafe casts at call sites.
- Each remaining disable is at a heterogeneous registry boundary, not a convenience escape.
**Verification Checks:**
- `npx eslint .`
- `npm run check`
- `npm run bundle`

## Final Verification by Coordinator

After consolidation, with user confirmation, because it publishes analysis to the Sonar server:

- `sonar-scanner`
- Query `api/issues/search?componentKeys=cf-api-gateway&resolved=false` and confirm `total` is 0.
