## User Request
Replace the gateway route config input with v2: named `origins` and `policies` maps, routes with a `methods` array referencing them by name, and a strict JSON Schema. Hard cutover, runtime behavior unchanged.

## Phase
The gateway validates and compiles only v2 config, and runtime behavior is unchanged.

## Tasks
- task-1: Schema and types. Rewrite `gatewayConfigSchema` in `src/config/schema.ts` per DESIGN "Config shape", "Per-type options", and "Schema technique": `additionalProperties: false` on every object including each options object, closed `type` enums, `allOf` of `if`/`then` per type, method enum `GET HEAD POST PUT PATCH DELETE OPTIONS`, `methods` `minItems: 1` and `uniqueItems: true`, map key pattern `^[a-z0-9][a-z0-9-]*$` via `propertyNames`. Replace `GatewayPolicyConfig`/`GatewayRouteConfig` in `src/gateway/types.ts` with `OriginConfig`, `PolicyConfig`, `RouteConfig`, and the new `GatewayConfig`. Keep `CompiledRoute` and all runtime types unchanged.
- task-2: Compiler. In `src/gateway/compiler.ts`, expand each route into one `CompiledRoute` per method; resolve origin and policies by name; reject unknown origin name, unknown policy name, a policy whose handler is absent from the phase it is listed in, and duplicate `(path, method)`; keep the auth rule per expanded method, the CORS wildcard-with-credentials rule, and the existing sort. Prefix every route error with `Route <METHOD> <path>: `. Remove duplicate-name detection.
- task-3: Config and tests. Rewrite `src/config.json` to v2 preserving every current path, method, origin option, and policy order; collapse identical-except-method routes into one route with `methods`. Result: top-level keys `origins`, `policies`, `routes` only, and 10 routes. Add schema tests and compiler tests listed in DESIGN "Testing". Migrate fixtures in the listed test files to v2 without changing any assertion.
- task-4: Docs. Update README config examples to v2 and remove the "Add routes for each HTTP method" note. Leave `docs/diagrams/configured-routes.mmd` unchanged.

## Context
- Design: `/home/ngosi/projects/cf-api-gateway/docs/plans/route-config-v2/DESIGN.md`. Read it fully first.
- Plan: `/home/ngosi/projects/cf-api-gateway/docs/plans/route-config-v2/PLAN.md`.
- Option types live in `src/origins/url.ts`, `src/origins/failover.ts`, and `src/policies/**`. Options schemas must match them exactly. Handler names come from `src/origins/index.ts`, `src/policies/request/index.ts`, `src/policies/response/index.ts`.
- `CompiledRequestPolicy.name` / `CompiledResponsePolicy.name` keep their meaning: set them to the policy map key.
- Current schema validation returns `OutputUnit[]`; keep that contract.

## Files
- Modify: `src/config/schema.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `src/config.json`
- Modify: `test/config-schema.test.ts`
- Modify: `test/analytics.test.ts`
- Modify: `test/auth0-jwt.test.ts`
- Modify: `test/config-source.test.ts`
- Modify: `test/gateway-pipeline.test.ts`
- Modify: `test/origin-failover.test.ts`
- Modify: `test/request-policies.test.ts`
- Modify: `test/response-cors.test.ts`
- Modify: `README.md`
- Create if needed: `test/compiler.test.ts` for compiler tests.
- Write: `docs/plans/route-config-v2/phase-01/notes.md`
- Out of scope, do not edit: `src/gateway/runtime.ts`, `src/origins/**`, `src/policies/**`, `src/config/source.ts`, `src/config/kv.ts`, `wrangler.toml`, `.dev.vars`, any secret-bearing file. Do not read `.dev.vars`.

## Done When
- `src/config.json` has top-level keys `origins`, `policies`, `routes` only, and 10 routes.
- Compiling bundled v1 config at base and v2 config at HEAD yields the same set of `(method, path, originType, origin options, request policy names, response policy names)` tuples. Base v1 config: `git show refs/plans/route-config-v2/base:src/config.json`.
- Schema rejects: a v1 document; an unknown key at root, origin, policy, route, and options levels; `methods: []`; duplicate method; `CONNECT`; `cors` missing `allowedOrigins`; `url` origin missing `url`.
- Compiler rejects: unknown origin name; unknown policy name; `cors` listed under `request`; duplicate `(path, method)`; `POST` without an `apiKeyOrAuth0` policy.
- No assertion line in a pre-existing test changes; only fixture objects change.
- No v1 compatibility path exists.
- `npm run check`
- `npm run bundle`
- `git diff --exit-code refs/plans/route-config-v2/base -- src/gateway/runtime.ts src/origins src/policies src/config/source.ts src/config/kv.ts`

## Rules
Follow these bundled files:
- Contract: /home/ngosi/projects/refract/plugin/shared/worker-contract.md
- Response: /home/ngosi/projects/refract/plugin/shared/erp.md
- Notes: /home/ngosi/projects/refract/plugin/shared/notes-template.md
- Journal: /home/ngosi/projects/refract/plugin/shared/journal-template.md
- Do not run any git command that changes state: no commit, stash, reset, checkout, restore, or clean.
- Use TDD for the new schema and compiler rules: write the failing test, then implement.
- Match existing code style. Do not refactor unrelated code.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
