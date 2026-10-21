# Lint and Sonar Cleanup Design

**Status:** Confirmed by user on 2026-10-21.

## Goal

`npx eslint .` reports zero problems. SonarQube project `cf-api-gateway` reports zero open issues. `npm run check` and `npm run bundle` keep passing.

## Baseline at `refs/plans/lint-sonar-cleanup/base` (119a96b)

ESLint: 262 problems in 20 files.

- 218 in `dist/index.js` and 2 unused-directive warnings in `worker-configuration.d.ts`. Both are build or generated output.
- 17 in `src/`: 12 `@typescript-eslint/no-explicit-any`, 3 `@typescript-eslint/no-unused-vars`, 1 `prefer-const`, 1 `no-useless-assignment`.
- 25 in `test/`: 10 `@typescript-eslint/no-explicit-any`, 9 `@typescript-eslint/no-unused-vars` on `_`-prefixed names, 1 `prefer-const`.

SonarQube: 3 open issues, 0 hotspots.

| Rule | Location | Message |
|---|---|---|
| `typescript:S2245` | `src/config/source.ts:65` | Make sure that using this pseudorandom number generator is safe here. |
| `typescript:S8786` | `src/policies/request/auth0-jwt.ts:53` | Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking. |
| `typescript:S7737` | `src/index.ts:65` | Do not use an object literal as default for parameter `dependencies`. |

## Decisions

1. **Ignore generated output.** `eslint.config.mjs` ignores `dist/`, `.wrangler/` and `worker-configuration.d.ts`.
2. **Unused `_` names.** Configure `@typescript-eslint/no-unused-vars` to ignore names that start with `_`. Unused catch bindings in `src/` use optional catch binding `catch {`.
3. **`any` types.** Make handler types generic on their options type, for example `TRequestPolicyHandler<TOptions = unknown>`. Each handler names its own options type. Registry and compiled types that hold handlers with different options types may keep `any` only through one `eslint-disable-next-line @typescript-eslint/no-explicit-any` per site, with a reason comment. Other `any` sites become `unknown` or a concrete type.
4. **S2245.** The default jitter source becomes `crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32`. The injectable `random` dependency stays.
5. **S8786.** Replace `/\/+$/` with a non-regex trailing-slash trim. Behavior is unchanged.
6. **S7737.** Move the default `{ logAnalytics }` to a module-level constant or resolve it inside the function body. The public signature stays call-compatible.
7. **Regression guard.** Add `"lint": "eslint ."` to `package.json` and a `Lint` step running `npm run lint` in `.github/workflows/ci.yml` before tests.

## Out of Scope

- Runtime behavior changes.
- New ESLint rules or stricter presets.
- Editing `worker-configuration.d.ts`, `dist/`, `wrangler.toml`, `.dev.vars`, `.env`.
