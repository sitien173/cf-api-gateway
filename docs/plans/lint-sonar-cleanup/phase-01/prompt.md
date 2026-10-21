## User Request
Fix all ESLint and SonarQube issues in this Cloudflare Worker TypeScript repo and enforce lint in CI. Full design: `docs/plans/lint-sonar-cleanup/DESIGN.md`. Plan: `docs/plans/lint-sonar-cleanup/PLAN.md`.

## Phase
Phase 1: ESLint reports zero problems apart from `@typescript-eslint/no-explicit-any`, and SonarQube issues S2245, S8786 and S7737 are resolved in code. No runtime behavior change.

## Tasks
- task-1: ESLint config ignores, unused-vars `_` pattern, `lint` script, CI lint step.
- task-2: Fix remaining non-`any` lint problems in `src/` and `test/`.
- task-3: Fix the three SonarQube issues and add an issuer trailing-slash test.

## Context
Current ESLint config `eslint.config.mjs`:

```js
export default defineConfig({
  files: ['**/*.{js,ts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
});
```

`npx eslint .` lints `dist/index.js` (218 problems) and `worker-configuration.d.ts` (2 unused-directive warnings). Both are build or generated output and must be ignored, not edited.

Non-`any` problems in source and tests:
- `src/config/source.ts:351` prefer-const: `refreshPromise` is declared with `let refreshPromise!: Promise<boolean>;` then assigned once.
- `src/gateway/runtime.ts:149` no-useless-assignment: `let isPreflight = false;` is reassigned at line 164 before any read; it is read at line 195.
- `src/index.ts:6` unused import `ErrorResponse`.
- `src/origins/url.ts:59` unused catch binding `err`.
- `src/policies/request/json-body-validation.ts:31` unused catch binding `e`.
- `test/config-source.test.ts:411` prefer-const `random`.
- `test/analytics.test.ts:134,141` `_env`; `test/config-kv.test.ts:23` `_options`; `test/config-schema.test.ts:18` `_routes` and `:67` `_type` from destructuring; `test/origin-failover.test.ts:262` `_args`, `:266` `_timer`. All unused `_`-prefixed names.

SonarQube issues:
- `typescript:S2245` at `src/config/source.ts:65`, in `getJitter`: `const random = dependencies.random ? dependencies.random() : Math.random();`. Used only for refresh-jitter timing.
- `typescript:S8786` at `src/policies/request/auth0-jwt.ts:53`, in `normalizeIssuer`: `issuerUrl.pathname = \`${issuerUrl.pathname.replace(/\/+$/, "")}/\`;`. Super-linear regex backtracking.
- `typescript:S7737` at `src/index.ts:65`: `executeUnavailableRequest(originalRequest, env, ctx, dependencies: ExecutionDependencies = { logAnalytics })`. Object literal used as a parameter default. It is called without the 4th argument at `src/index.ts:118` and with it in `test/gateway-pipeline.test.ts:683,709`.

CI file `.github/workflows/ci.yml` has steps: Install dependencies (`npm ci`), Type-check and test (`npm run check`), and others.

TypeScript is 4.9 with `strict: true` and target `es2021`. Optional catch binding is supported.

## Files
- `eslint.config.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- `src/config/source.ts`
- `src/gateway/runtime.ts`
- `src/index.ts`
- `src/origins/url.ts`
- `src/policies/request/json-body-validation.ts`
- `src/policies/request/auth0-jwt.ts`
- `test/config-source.test.ts`
- `test/config-schema.test.ts` only if the `_` ignore pattern does not cover its destructured names
- `test/auth0-jwt.test.ts`
- Out of scope, do not edit: `dist/**`, `worker-configuration.d.ts`, `wrangler.toml`, `.dev.vars`, `.env`, `sonar-project.properties`, `package-lock.json`, `docs/plans/**` except this phase's `notes.md` and `journal.md`, any secret-bearing file. Do not fix `@typescript-eslint/no-explicit-any` problems; Phase 2 owns them.

## Done When
- In `eslint.config.mjs`, a global ignores entry covers `dist/`, `.wrangler/` and `worker-configuration.d.ts`. `@typescript-eslint/no-unused-vars` has `argsIgnorePattern`, `varsIgnorePattern` and `destructuredArrayIgnorePattern` set to `"^_"`.
- `package.json` scripts has `"lint": "eslint ."`. `.github/workflows/ci.yml` has a `Lint` step running `npm run lint` after `npm ci` and before `npm run check`.
- No new `eslint-disable` comments anywhere.
- `src/config/source.ts` default jitter source is `crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32`; no `Math.random` call remains in that file. Injected `dependencies.random` still takes precedence. Jitter stays in `[0, REFRESH_JITTER_MS)`.
- `normalizeIssuer` strips all trailing `/` without a regex. Output is unchanged for pathnames `/`, `/a`, `/a/`, `/a///`. `test/auth0-jwt.test.ts` has a test proving an issuer with several trailing slashes normalizes to a single trailing slash, unless an existing test already proves it.
- `executeUnavailableRequest` has no object-literal parameter default and calls without the 4th argument still use `{ logAnalytics }`.
- `isPreflight` fix in `src/gateway/runtime.ts` does not change when or what is read.
- `npx eslint . --rule '@typescript-eslint/no-explicit-any: off'` exits 0 with no output.
- `npm run check` passes.
- `npm run bundle` passes.

## Rules
Follow these bundled files:
- Contract: /home/ngosi/projects/refract/plugin/shared/worker-contract.md
- Response: /home/ngosi/projects/refract/plugin/shared/erp.md
- Notes: /home/ngosi/projects/refract/plugin/shared/notes-template.md
- Journal: /home/ngosi/projects/refract/plugin/shared/journal-template.md

Phase notes file: `docs/plans/lint-sonar-cleanup/phase-01/notes.md`. Phase journal: `docs/plans/lint-sonar-cleanup/phase-01/journal.md`.
Do not run any Git command that changes state: no commit, stash, reset, checkout or clean.
Do not run `sonar-scanner` or contact any network service.
Make the minimum change per finding. Match surrounding code style: double quotes and trailing commas in `src/`, single quotes in `eslint.config.mjs`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
