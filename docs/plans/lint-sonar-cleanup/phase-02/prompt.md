## User Request
Fix all ESLint and SonarQube issues in this Cloudflare Worker TypeScript repo. Phase 1 is done. Design: `docs/plans/lint-sonar-cleanup/DESIGN.md`, decision 3. Plan: `docs/plans/lint-sonar-cleanup/PLAN.md`, Phase 2.

## Phase
Phase 2: remove every `@typescript-eslint/no-explicit-any` problem with a type-only refactor. Handler types become generic on their options type. No runtime change.

## Tasks
- task-1: Make handler types in `src/types/index.ts` generic on `TOptions` with default `unknown`, and type each handler in `src/policies/**` and `src/origins/**` with its own options type.
- task-2: Remove `any` from `src/gateway/types.ts`, `src/gateway/compiler.ts`, `src/gateway/logging.ts` and `src/index.ts`.
- task-3: Remove `any` from the four test files.

## Context
`npx eslint .` reports exactly 27 problems, all `@typescript-eslint/no-explicit-any`:

- `src/types/index.ts:16` is the `RequestPolicyEnv` index signature `[key: string]: any`. Lines 21, 27, 35, 40 and 45 are `options: any` in `TRequestPolicyHandler`, `TResponsePolicyHandler`, `TRequestPolicy`, `TResponsePolicy` and `TOriginHandler`.
- `src/gateway/types.ts:13` is an env index signature `[key: string]: any`. Lines 18 and 24 are `options?: any` in `OriginConfig` and `PolicyConfig`. Lines 51 and 57 are `options?: any` in `CompiledRequestPolicy` and `CompiledResponsePolicy`. Line 70 is `options?: any` in `CompiledRoute.origin`. `GatewayHandlers` holds `Record<string, TRequestPolicyHandler>`, `Record<string, TResponsePolicyHandler>` and `Record<string, TOriginHandler>`.
- `src/gateway/compiler.ts:39` is `TPolicy extends { name: string; options?: any; handler: any }` in `resolvePolicies`. Line 43 is `resolver: Record<string, any>`. Line 59 is `(handler as any).compile?.(definition.options);`.
- `src/gateway/logging.ts:28` is `env?: { GATEWAY_LOG_LEVEL?: string; [key: string]: any }`.
- `src/index.ts:23` is the `Env` index signature `[key: string]: any; // for analytics env`.
- Tests: `test/gateway-pipeline.test.ts:523` is `(response: Response, options: any)`, and `:685` is an env literal `as any`. `test/origin-logging.test.ts:40,41` are log event literals `as any`. Lines 217, 252 and 293 are origin options literals `as any`. `test/request-policies.test.ts:23` is `schema: null as any`. `test/response-cors.test.ts:21` is a cors options literal `as any`.

Handlers today narrow `options` in their own signature, for example:
- `export const changeMethod: TRequestPolicyHandler = async (request: IRequest, options: ChangeMethodOptions) => ...`
- `export const cors: TResponsePolicyHandler = (response: Response, options: CorsOptions, request?: Request) => ...`
- `export const url: TOriginHandler = async (request: IRequest, options: UrlOptions) => ...`
- `export const proxyAll: TOriginHandler = (request, options) => executeFailoverOrigin(request, options, "proxyAll");`. `executeFailoverOrigin` takes `options: FailoverOriginOptions`.
- `src/policies/request/json-body-validation.ts` has `type JsonBodyValidationHandler = TRequestPolicyHandler & { compile?: (options: { schema: object }) => void }` and exports `jsonBodyValidation: TRequestPolicyHandler`.
- `apiKeyOrAuth0` takes `_options: unknown`.

Under `strict` with `strictFunctionTypes`, a function-type alias is contravariant in its parameters. So `TRequestPolicyHandler<ChangeMethodOptions>` is not assignable to `TRequestPolicyHandler<unknown>`. A registry that holds handlers with different options types therefore needs one of these:
- (a) `any` at that registry boundary, with `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>`, or
- (b) a method-signature form that TypeScript checks bivariantly, which needs no `any`.

Pick whichever gives the smaller, clearer diff. Document the choice in notes.

TypeScript is 4.9. `npm run check` runs `tsc --noEmit` and then the tests.

## Files
- `src/types/index.ts`
- `src/gateway/types.ts`
- `src/gateway/compiler.ts`
- `src/gateway/logging.ts`
- `src/index.ts`
- `src/policies/request/auth0-jwt.ts`, `basic-auth.ts`, `change-method.ts`, `json-body-validation.ts`
- `src/policies/response/add-headers.ts`, `cors.ts`
- `src/origins/url.ts`, `proxyAll.ts`, `upstreamWithFallback.ts`, and `src/origins/failover.ts` only if its exported types must change
- `test/gateway-pipeline.test.ts`
- `test/origin-logging.test.ts`
- `test/request-policies.test.ts`
- `test/response-cors.test.ts`
- Out of scope, do not edit: `eslint.config.mjs`, `dist/**`, `worker-configuration.d.ts`, `wrangler.toml`, `.dev.vars`, `.env`, `package.json`, `package-lock.json`, `docs/plans/**` except this phase's `notes.md` and `journal.md`, and any secret-bearing file.

## Done When
- `npx eslint .` exits 0 with no output.
- `grep -rn "eslint-disable" src test` lists at most 4 lines. Each names `@typescript-eslint/no-explicit-any` and has a `-- <reason>` naming the heterogeneous registry boundary.
- No `as unknown as` double casts are added in `src/`.
- Handler options types still match what the compiler passes from `PolicyConfig.options` and `OriginConfig.options`.
- `npm run check` passes.
- `npm run bundle` passes.

## Rules
Follow these bundled files:
- Contract: /home/ngosi/projects/refract/plugin/shared/worker-contract.md
- Response: /home/ngosi/projects/refract/plugin/shared/erp.md
- Notes: /home/ngosi/projects/refract/plugin/shared/notes-template.md
- Journal: /home/ngosi/projects/refract/plugin/shared/journal-template.md

Phase notes file: `docs/plans/lint-sonar-cleanup/phase-02/notes.md`. Phase journal: `docs/plans/lint-sonar-cleanup/phase-02/journal.md`.
Do not run any Git command that changes state: no commit, stash, reset, checkout or clean.
Do not run `sonar-scanner` or contact any network service.
Type-only changes. Do not change runtime logic. Match the surrounding code style.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
