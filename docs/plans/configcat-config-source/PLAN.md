# Plan: ConfigCat as the gateway configuration source

Design: [DESIGN.md](DESIGN.md)

Replace the bundled `src/config.json` with a ConfigCat Text setting holding the
whole routing document, fetched in ManualPoll mode, validated, compiled, and
cached per isolate, with Workers KV backing both the SDK cache and a validated
last-known-good copy.

## Operator prerequisites

These are human actions outside the code phases. Phase 4 cannot be deployed and
Phase 5 cannot start until they are done.

1. Create the ConfigCat setting `gateway_config`, type Text, in every
   environment, populated with the minified contents of the current
   `src/config.json`.
2. Confirm ConfigCat's maximum Text setting length accepts 5441 bytes.
3. Create the Workers KV namespace and record its id for `wrangler.toml`.
   Confirm whether this namespace is shared with any other gateway deployment,
   since key scoping in Phase 2 depends on the answer.
4. `wrangler secret put CONFIGCAT_SDK_KEY` for each environment.
5. Create `.dev.vars` locally containing `CONFIGCAT_SDK_KEY` for a dev
   environment key.

## Phase sequence

Phases 1 through 4 are code and ship together as deploy 1, with
`src/config.json` still present as the final candidate in the resolution
ladder. Phase 5 is deploy 2 and is gated on production verification of
deploy 1.

The sentinel default is in place from Phase 2, so deploy 1 exercises the same
resolution algorithm deploy 2 runs. Phase 5 only removes a candidate.

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

### Phase 2: ConfigCat and KV adapter

**Task Guide Input:** Add the `@configcat/sdk` dependency to a Cloudflare
Workers TypeScript project and implement the storage and client adapter layer: a
Workers KV backed `IConfigCatCache`, gateway-scoped key derivation, and a
last-known-good envelope reader and writer with timestamp comparison. No
resolution logic in this phase. Includes unit tests run with `tsx --test`.
Non-UI repository implementation.

**Goal:** A tested adapter that the resolver in Phase 3 can consume, with no
gateway resolution behavior of its own.

**Files:**
- Create: `src/config/kv.ts`
- Create: `test/config-kv.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Tasks:**
1. Add `@configcat/sdk` as a dependency.
2. Implement gateway-scoped key derivation for both prefixes,
   `cc:<gatewayName>:<sdkCacheKey>` and `lkg:<gatewayName>:gateway_config`,
   reading `gatewayName` from `GATEWAY_NAME`. Derivation fails explicitly when
   `GATEWAY_NAME` is unset rather than falling back to an unscoped key.
3. Implement the KV backed `IConfigCatCache` with `get` and `set`, passing
   `cacheTtl: 60` on reads.
4. Implement `readLkg` and `writeLkg` over an envelope carrying the raw
   document and its ConfigCat config timestamp. `writeLkg` is a no-op when the
   stored envelope's timestamp is greater than or equal to the incoming one.

**Acceptance Criteria:**
- Key derivation throws or returns an explicit error when `GATEWAY_NAME` is
  unset, verified by test.
- Two gateway names produce disjoint keys for both prefixes, verified by test.
- `writeLkg` does not overwrite a newer stored envelope, verified by test.
- A KV write rejection surfaces as a caught error, not an unhandled rejection.
- `src/index.ts` is unchanged.

**Reviewer Checklist:**
- The `cc:` prefix is applied to the key the SDK supplies rather than replacing
  it, so the SDK's own cache-key semantics are preserved.
- The envelope format is versioned or otherwise tolerant of a legacy raw-string
  value, since Phase 4 ships before any envelope exists in KV.
- No resolution, validation, or compilation logic leaked into this phase.

**Verification Checks:**
- `npm run typecheck`
- `npm test`

**Commit:** `feat(config): add KV adapter and ConfigCat cache for gateway config`

---

### Phase 3: Gateway resolution state machine

**Task Guide Input:** Implement a Cloudflare Workers module that resolves a
compiled API gateway from a ConfigCat Text setting in ManualPoll mode, using an
ordered candidate ladder where each candidate is parsed, validated, and compiled
before acceptance, plus an isolate-local refresh gate with in-flight tracking,
generation guarding, jitter, and failure backoff. Consumes an existing KV
adapter and schema validator. Includes unit tests run with `tsx --test`. Non-UI
repository implementation.

**Goal:** `resolveGateway` returns a `CompiledGateway` or undefined, doing no
I/O on the steady-state path, with every candidate and refresh branch tested.

**Files:**
- Create: `src/config/source.ts`
- Create: `test/config-source.test.ts`

**Tasks:**
1. Implement the isolate-level state: `client`, `compiled`, `lastRaw`,
   `nextRefreshMs`, `refreshInFlight`, `generation`. Create the ConfigCat client
   inside the request path, since the KV binding arrives on `env`.
2. Implement the candidate ladder in order: ConfigCat value with a sentinel
   default, `lkg`, one bounded inline `forceRefreshAsync`, then an optional
   caller-supplied final candidate. Each candidate is parsed, schema-validated,
   and passed through `compileGateway` before acceptance. A candidate failing
   any step is logged at error level with its reason and the ladder continues.
3. Implement the refresh gate: serve `compiled` when `Date.now() <
   nextRefreshMs`; skip scheduling when `refreshInFlight` is set; set
   `nextRefreshMs` when the refresh settles, to 60000 plus 0 to 15000 jitter on
   success and 5000 on failure; discard a refresh result whose captured
   `generation` is stale.
4. Write `lkg` only from a fresh CDN refresh result that validated and
   compiled, never from a KV-sourced or final-candidate document. Log the
   adopted candidate and a short document hash on every successful resolution.

**Acceptance Criteria:**
- Warm isolate inside the refresh window performs no `getValueAsync`, KV read,
  or fetch, verified by asserting zero calls on injected fakes.
- A malformed non-sentinel ConfigCat value falls through to a valid `lkg` and
  serves successfully rather than returning undefined.
- A corrupt `lkg` falls through to the inline refresh candidate.
- Concurrent requests on a cold isolate trigger exactly one refresh.
- A failed refresh permits a retry after roughly 5 seconds, not 60.
- A refresh completing after a newer refresh does not overwrite the newer
  `compiled`.
- A KV-sourced document does not trigger an `lkg` write.
- Every candidate failing returns undefined.
- Each successful resolution emits a log carrying the adopted candidate name.

**Reviewer Checklist:**
- Candidate acceptance happens only after `compileGateway` succeeds, not after
  schema validation alone, so the auth0 invariant at
  `src/gateway/compiler.ts:86` participates in candidate selection.
- The bundled document is a caller-supplied parameter, not the `getValueAsync`
  default, so a cache miss stays distinguishable from a real ConfigCat value.
- `refreshInFlight` is cleared in a `finally`, so a thrown refresh cannot
  deadlock the gate permanently.
- `nextRefreshMs` is set on settle rather than on start.
- Dependency injection matches the existing `ExecutionDependencies` shape at
  `src/gateway/runtime.ts:127` rather than inventing a new pattern.
- Jitter uses a bounded range and cannot produce a negative or zero interval.

**Verification Checks:**
- `npm run typecheck`
- `npm test`

**Commit:** `feat(config): resolve gateway config from ConfigCat with KV fallback`

---

### Phase 4: Worker wiring and bindings

**Task Guide Input:** Rewire a Cloudflare Workers entry point to resolve its
gateway configuration asynchronously per request instead of compiling a bundled
JSON import at module scope, add a KV namespace binding and secret to
`wrangler.toml`, and return 503 through the existing response finalization path
when no configuration resolves. Non-UI repository implementation.

**Goal:** The deployed worker resolves config through the ladder, with the
bundled document as the final candidate.

**Files:**
- Modify: `src/index.ts`
- Modify: `wrangler.toml`
- Modify: `.gitignore`
- Modify: `test/gateway-pipeline.test.ts`

**Tasks:**
1. Replace the module-scope `compileGateway` call with an awaited
   `resolveGateway` inside `fetch`, passing the imported `src/config.json` as
   the final ladder candidate.
2. Return 503 when resolution yields undefined, routed through the same
   finalization path that produces analytics and logs for `route_miss` in
   `src/gateway/runtime.ts:78`.
3. Add `CONFIGCAT_SDK_KEY` and `GATEWAY_CONFIG` to the `Env` interface, and add
   the KV namespace binding to `wrangler.toml`.
4. Add `.dev.vars` to `.gitignore`.

**Acceptance Criteria:**
- `src/config.json` is still imported and still present.
- A request resolving no config returns 503 rather than throwing.
- The 503 path emits an analytics event and a log entry, verified by test
  against the existing `logEvent` injection pattern.
- `npm run bundle` succeeds.
- Existing test assertions are unchanged.

**Reviewer Checklist:**
- The 503 response uses the existing `ErrorResponse` helper and passes through
  `finalizeResponse`, so it is not a bare `Response` that silently skips
  analytics.
- No secret value is committed; only the binding name appears in
  `wrangler.toml`.
- The KV namespace id in `wrangler.toml` matches the namespace the operator
  created, and is not a placeholder.

**Verification Checks:**
- `npm run typecheck`
- `npm test`
- `npm run bundle`

**Commit:** `feat(config): wire ConfigCat gateway resolution into worker`

---

### Phase 5: Remove bundled config and update docs

**Blocked until:** deploy 1 is live and an operator has confirmed, using the
adopted-candidate log line, that config resolved from ConfigCat rather than the
bundled candidate, and that `lkg:<gatewayName>:gateway_config` is populated in
KV.

**Task Guide Input:** Delete a bundled JSON configuration file from a Cloudflare
Workers project, remove it as the final fallback candidate in the config
resolution ladder, and update README and diagram documentation that referenced
it. Non-UI repository implementation.

**Files:**
- Delete: `src/config.json`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `docs/diagrams/architecture.mmd`
- Modify: `docs/diagrams/README.md`

**Tasks:**
1. Delete `src/config.json`, remove its import, and stop passing the final
   ladder candidate.
2. Update `README.md` lines 29, 34, 333, and 474 to describe ConfigCat as the
   configuration source, including the `.dev.vars` requirement and the fact
   that local development now needs network access to ConfigCat.
3. Update `docs/diagrams/architecture.mmd:6` and `docs/diagrams/README.md:7`.

**Acceptance Criteria:**
- No file in `src/` or `test/` references `config.json`.
- `npm run bundle` succeeds with no bundled routing document.
- `README.md:29` no longer references the nonexistent `src/config.simple.json`.
- `src/config/source.ts` is unchanged, since the ladder already supports an
  absent final candidate from Phase 3.

**Reviewer Checklist:**
- No resolution logic changed in this phase, only the candidate supplied by the
  caller.
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
  SDK source, not documented. The candidate ladder makes the design correct
  either way.
- Whether the KV namespace is shared with other gateway deployments. Operator
  prerequisite 3. Key scoping is implemented regardless, but a shared namespace
  raises the severity of getting it right.

## Consultation record

Job `17a37b05-8802-4451-bf87-a22247cc9294`, workflow `consult`, verdict sound
in direction with corrections required before implementation. Findings adopted:
cold-start candidate ordering, last-known-good regression, KV namespace
collision, refresh in-flight tracking and backoff, refresh fan-out jitter, the
Phase 2 split, and the analytics bypass on the 503 path.

One deviation. The consultation proposed immutable versioned `lkg:<revision>`
keys to prevent regression. That requires a pointer key to locate the current
revision, which reintroduces the same race with more moving parts. This plan
instead qualifies `lkg` writes by provenance and compares the stored ConfigCat
timestamp, which closes the same failure with less machinery and removes cold
isolate write amplification as a side effect.
