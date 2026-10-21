# Route Config v2 Plan

**Design:** `docs/plans/route-config-v2/DESIGN.md`
**Base:** `refs/plans/route-config-v2/base` (37afdb8)

**Commit:** `feat(config)!: route config v2 with named origins, methods array, and strict schema`

## Scope Note

The change is one phase. Changing `GatewayConfig` breaks every fixture at once, so schema, compiler, bundled config, and tests must land together for `npm run check` to pass.

### Phase 1: Gateway accepts only the v2 route config with a strict schema

**Task Guide Input:** Non-UI repository implementation in TypeScript for a Cloudflare Worker. Replace the gateway config input shape with v2 per `docs/plans/route-config-v2/DESIGN.md`: strict JSON Schema, new input types, compiler expansion of `methods`, bundled config rewrite, test fixture migration, README update.
**Goal:** The gateway validates and compiles only v2 config, and runtime behavior is unchanged.
**Files:**
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
- Out of scope, do not edit: `src/gateway/runtime.ts`, `src/origins/**`, `src/policies/**`, `src/config/source.ts`, `src/config/kv.ts`, `wrangler.toml`, `.dev.vars`, any secret-bearing file.
**Tasks:**
1. Schema and types: rewrite `gatewayConfigSchema` in `src/config/schema.ts` per DESIGN "Config shape", "Per-type options", and "Schema technique" (`additionalProperties: false` everywhere, closed `type` enums, `allOf` of `if`/`then` per type, method enum `GET HEAD POST PUT PATCH DELETE OPTIONS`, `methods` `minItems: 1` and `uniqueItems: true`, name key pattern `^[a-z0-9][a-z0-9-]*$` via `propertyNames`). Replace `GatewayPolicyConfig`/`GatewayRouteConfig` in `src/gateway/types.ts` with `OriginConfig`, `PolicyConfig`, `RouteConfig`, and the new `GatewayConfig`. Keep `CompiledRoute` and all runtime types unchanged.
2. Compiler: in `src/gateway/compiler.ts`, expand each route into one `CompiledRoute` per method; resolve origin and policies by name; reject unknown origin name, unknown policy name, a policy whose handler is absent from the phase it is listed in, and duplicate `(path, method)`; keep the auth rule per expanded method, the CORS wildcard-with-credentials rule, and the existing sort. Prefix every route error with `Route <METHOD> <path>: `. Remove duplicate-name detection.
3. Config and tests: rewrite `src/config.json` to v2 preserving every current path, method, origin option, and policy order; collapse identical-except-method routes into one route with `methods`. Add schema tests and compiler tests listed in DESIGN "Testing". Migrate fixtures in the listed test files to v2 without changing any assertion.
4. Docs: update README config examples to v2 and remove the "Add routes for each HTTP method" note. Leave `docs/diagrams/configured-routes.mmd` unchanged; it shows routing behavior, not config shape.
**Acceptance Criteria:**
- `src/config.json` has top-level keys `origins`, `policies`, `routes` only, and 10 routes.
- Compiling bundled v1 config at base and v2 config at HEAD yields the same set of `(method, path, originType, origin options, request policy names, response policy names)` tuples.
- Schema rejects: a v1 document; an unknown key at root, origin, policy, route, and options levels; `methods: []`; duplicate method; `CONNECT`; `cors` missing `allowedOrigins`; `url` origin missing `url`.
- Compiler rejects: unknown origin name; unknown policy name; `cors` listed under `request`; duplicate `(path, method)`; `POST` without an `apiKeyOrAuth0` policy.
- No assertion line in a pre-existing test changes; only fixture objects change.
- `src/gateway/runtime.ts`, `src/origins/**`, `src/policies/**`, `src/config/source.ts` show no diff.
**Reviewer Checklist:**
- Diff assertions separately from fixtures in migrated tests; any changed expectation is a spec failure.
- Verify route and policy order equivalence between base and HEAD `src/config.json`.
- Confirm options schemas match the option types in `src/origins/url.ts`, `src/origins/failover.ts`, and `src/policies/**`.
- Confirm `if`/`then` branches do not leak `additionalProperties` conflicts with parent `properties`.
- Confirm no v1 compatibility path exists.
**Verification Checks:**
- `npm run check`
- `npm run bundle`
- `git diff --exit-code refs/plans/route-config-v2/base -- src/gateway/runtime.ts src/origins src/policies src/config/source.ts src/config/kv.ts`

## Post-Merge Deploy Steps

Owned by the user, outside this plan:

1. Deploy the worker.
2. Publish v2 `src/config.json` content to ConfigCat flag `gateway_config`.
3. Do not publish to ConfigCat before step 1.
