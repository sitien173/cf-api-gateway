# Plan: ConfigCat as the gateway configuration source

Design: [DESIGN.md](DESIGN.md)

Replace the bundled `src/config.json` with a ConfigCat Text setting holding the
whole routing document, fetched in ManualPoll mode, validated, compiled, and
cached per isolate, with Workers KV backing both the SDK cache and a validated
last-known-good copy.

## Operator prerequisites

These are human actions outside the code phases. Phase 3 cannot be deployed and
Phase 4 cannot start until they are done.

1. Create the ConfigCat setting `gateway_config`, type Text, in every
   environment, populated with the minified contents of the current
   `src/config.json`.
2. Confirm ConfigCat's maximum Text setting length accepts 5441 bytes.
3. Create the Workers KV namespace and record its id for `wrangler.toml`.
4. `wrangler secret put CONFIGCAT_SDK_KEY` for each environment.
5. Create `.dev.vars` locally containing `CONFIGCAT_SDK_KEY` for a dev
   environment key.

## Phase sequence

Phases 1 through 3 are code and ship together as deploy 1, with
`src/config.json` still bundled as the fallback. Phase 4 is deploy 2 and is
gated on production verification of deploy 1.

---

### Phase 1: Config document validation

**Task Guide Input:** Add a JSON Schema and validation function for the gateway
routing document to a Cloudflare Workers TypeScript project, using the already
installed `@cfworker/json-schema`. Includes unit tests run with `tsx --test`.
Non-UI repository implementation.

**Goal:** A pure function that accepts a parsed routing document and reports
whether its shape is valid, with tests.

**Files:**
- Create: `src/config/schema.ts`
- Create: `test/config-schema.test.ts`

**Tasks:**
1. Define the JSON Schema for the routing document covering shape only:
   `routes` and `policies` required arrays; each route requiring `path`,
   `method`, `origin.type`, `policies.request`, `policies.response`; `path` and
   `method` as strings; both policy lists as arrays of strings; each policy
   requiring `name` and `type` as strings. Leave `origin.options` and policy
   `options` unconstrained.
2. Export a `validateGatewayConfig(value: unknown)` returning a discriminated
   result carrying either the typed `GatewayConfig` or the validation errors.
3. Write tests covering a valid document, a document missing `routes`, a
   document where `policies.request` is not an array, and a route missing
   `origin.type`.

**Acceptance Criteria:**
- `validateGatewayConfig` accepts the current contents of `src/config.json`.
- Each malformed fixture is rejected with a non-empty error list.
- No enums for origin types, policy types, or HTTP methods appear in the schema.
- `src/config.json` and `src/index.ts` are unchanged.

**Reviewer Checklist:**
- Schema does not duplicate knowledge already enforced by `compileGateway`,
  specifically origin type, policy type, and policy name resolution.
- No attempt to express the auth0 invariant in the schema, which JSON Schema
  cannot represent across the two arrays.
- Result type is discriminated rather than throwing.

**Verification Checks:**
- `npm run typecheck`
- `npm test`

**Commit:** `feat(config): add routing document schema validation`

---

### Phase 2: ConfigCat source module

**Task Guide Input:** Add the `@configcat/sdk` dependency and implement a
Cloudflare Workers module that resolves a compiled gateway from a ConfigCat Text
setting in ManualPoll mode, with a Workers KV backed `IConfigCatCache`, an
isolate-local 60 second refresh gate, a validated last-known-good KV fallback,
and dependency injection for tests. Includes unit tests run with `tsx --test`.
Non-UI repository implementation.

**Goal:** `resolveGateway` returns a `CompiledGateway` or undefined, doing no
I/O on the steady-state path, with every failure branch covered by tests.

**Files:**
- Create: `src/config/source.ts`
- Create: `test/config-source.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Tasks:**
1. Add `@configcat/sdk` as a dependency and import the Cloudflare Worker entry
   point `@configcat/sdk/cloudflare-worker`.
2. Implement the KV backed `IConfigCatCache` with `get` and `set`, prefixing
   keys with `cc:` and passing `cacheTtl: 60` on reads.
3. Implement `resolveGateway(env, ctx, dependencies)` with the isolate-level
   state, the 60 second refresh gate that sets its timestamp before scheduling,
   the background refresh through `ctx.waitUntil`, the cold start resolution
   order of SDK value then `lkg:gateway_config` then one inline
   `forceRefreshAsync`, and the `lkg` write on successful compile.
4. Write tests using a `Map` backed fake KV and injected fakes covering: warm
   isolate serves without I/O; two requests inside 60 seconds trigger exactly
   one refresh; validation failure on a warm isolate retains the previous
   gateway; validation failure on a cold isolate compiles from `lkg`; sentinel
   plus empty `lkg` plus failed inline refresh returns undefined; successful
   compile writes `lkg`.

**Acceptance Criteria:**
- All six test cases pass.
- The steady-state path performs no `getValueAsync`, KV read, or fetch.
- `compileGateway` throwing is handled identically to schema failure.
- A `lkg` write failure does not propagate to the caller.
- `src/index.ts` is unchanged.

**Reviewer Checklist:**
- `lastRefreshMs` is assigned before the refresh is scheduled, not after, so
  concurrent requests in one isolate cannot stack refreshes.
- The ConfigCat client is created inside the request path, not at module scope,
  because the KV binding arrives on `env`.
- Background refresh failures leave `compiled` intact and are logged.
- Dependency injection matches the existing `ExecutionDependencies` shape at
  `src/gateway/runtime.ts:127` rather than inventing a new pattern.
- The `lkg` key is written only after both schema validation and a successful
  `compileGateway`.

**Verification Checks:**
- `npm run typecheck`
- `npm test`

**Commit:** `feat(config): resolve gateway config from ConfigCat with KV fallback`

---

### Phase 3: Worker wiring and bindings

**Task Guide Input:** Rewire a Cloudflare Workers entry point to resolve its
gateway configuration asynchronously per request instead of compiling a bundled
JSON import at module scope, add a KV namespace binding and secret to
`wrangler.toml`, and return 503 when no configuration can be resolved. Keep the
bundled JSON as the fallback value for this deploy. Non-UI repository
implementation.

**Files:**
- Modify: `src/index.ts`
- Modify: `wrangler.toml`
- Modify: `.gitignore`
- Modify: `test/gateway-pipeline.test.ts`

**Tasks:**
1. Replace the module-scope `compileGateway` call with an awaited
   `resolveGateway` inside `fetch`, returning 503 when it yields undefined.
2. Add `CONFIGCAT_SDK_KEY` and `GATEWAY_CONFIG` to the `Env` interface, and add
   the KV namespace binding to `wrangler.toml`.
3. Pass the bundled `src/config.json` as the fallback value in place of the
   sentinel for this deploy only.
4. Add `.dev.vars` to `.gitignore`.

**Acceptance Criteria:**
- `src/config.json` is still imported and still present.
- A request resolving no config returns 503 rather than throwing.
- `npm run bundle` succeeds.
- Existing tests pass without modification to their assertions.

**Reviewer Checklist:**
- The 503 response uses the existing `ErrorResponse` helper rather than a raw
  `Response`.
- Analytics and logging behavior for the 503 path is consistent with the
  existing `route_miss` handling in `src/gateway/runtime.ts`.
- No secret value is committed; only the binding name appears in
  `wrangler.toml`.

**Verification Checks:**
- `npm run typecheck`
- `npm test`
- `npm run bundle`

**Commit:** `feat(config): wire ConfigCat gateway resolution into worker`

---

### Phase 4: Remove bundled config and update docs

**Blocked until:** deploy 1 is live and an operator has confirmed that routes
resolve from ConfigCat and that `lkg:gateway_config` is populated in KV.

**Task Guide Input:** Delete a bundled JSON configuration file from a Cloudflare
Workers project, switch its fallback to a sentinel value, and update README and
diagram documentation that referenced it. Non-UI repository implementation.

**Files:**
- Delete: `src/config.json`
- Modify: `src/index.ts`
- Modify: `src/config/source.ts`
- Modify: `README.md`
- Modify: `docs/diagrams/architecture.mmd`
- Modify: `docs/diagrams/README.md`

**Tasks:**
1. Delete `src/config.json` and remove its import.
2. Switch the `getValueAsync` fallback from the bundled document to the
   sentinel, so the `lkg` path becomes reachable.
3. Update `README.md` lines 29, 34, 333, and 474 to describe ConfigCat as the
   configuration source, including the `.dev.vars` requirement for local
   development and the fact that local development now needs network access.
4. Update `docs/diagrams/architecture.mmd:6` and `docs/diagrams/README.md:7`.

**Acceptance Criteria:**
- No file in `src/` or `test/` references `config.json`.
- `npm run bundle` succeeds with no bundled routing document.
- `README.md:29` no longer references the nonexistent `src/config.simple.json`.

**Reviewer Checklist:**
- The sentinel value cannot collide with a legitimate config document.
- Tests do not depend on the deleted file.
- Documentation states the rollback path is `wrangler rollback` to a bundle that
  still contains the file.

**Verification Checks:**
- `npm run typecheck`
- `npm test`
- `npm run bundle`
- `tgrep -F "config.json" src test`

**Commit:** `refactor(config): remove bundled routing document`

---

## Open items carried from design

- ConfigCat maximum Text setting length is unverified. Operator prerequisite 2.
- Whether ManualPoll `getValueAsync` returns a config placed in the external
  cache by another isolate without a prior `forceRefreshAsync` is inferred from
  SDK source, not documented. Phase 2 test coverage of the `lkg` fallback makes
  the design correct either way.
