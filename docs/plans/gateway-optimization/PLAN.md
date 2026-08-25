# Plan: cf-api-gateway optimization

Slug: `gateway-optimization`
Source: B-001
Design: `docs/plans/gateway-optimization/DESIGN.md`

Five module phases. Each phase is independently reviewed and committed.
Verification for every phase is `npm run check` plus the phase-specific tests.

## Phase 1: CORS bundle

**Task Guide Input:** Repository change. Fix the four CORS findings S1-S4 in a
Cloudflare Workers TypeScript gateway. S1: wildcard CORS origin matching must
require https except for explicit localhost dev exceptions. S2: reject the
compiled configuration when a cors policy combines `allowedOrigins: ["*"]` with
`allowCredentials: true`. S3: append `Vary: Origin` whenever allowedOrigins is
not exactly `["*"]`, including when no origin matches. S4: when allowedHeaders
is `["*"]` and allowCredentials is true, echo the request
`Access-Control-Request-Headers` header instead of emitting `*`.

**Goal:** CORS policy handling is secure and spec-correct without config edits.

**Files:**
- Modify: `src/policies/response/cors.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `test/response-cors.test.ts`
- Modify: `test/response-cors-wildcard.test.ts`

**Tasks:**
1. In `findAllowedOrigin`, require `requestUrl.protocol === "https:"` for
   wildcard suffix matches, with `http://localhost` and `http://127.0.0.1`
   allowed as explicit dev exceptions. Exact allowlist entries unchanged.
2. Append `Vary: Origin` when `allowedOrigins` is not exactly `["*"]`, before
   the match-result branch, so non-matching origins also get it.
3. When `allowCredentials` is true and `allowedHeaders` is `["*"]`, set
   `Access-Control-Allow-Headers` to the request `Access-Control-Request-Headers`
   value, falling back to the literal `*` when the request header is absent.
4. In `compileGateway`, reject any cors policy whose options set
   `allowedOrigins` containing `*` together with `allowCredentials: true`.
5. Add tests: http wildcard rejection, localhost exception, non-matching Vary,
   header echo with credentials, and compile-time rejection.

**Acceptance Criteria:**
- `http://evil.udemy.com` does not match a `*.udemy.com` wildcard origin.
- `http://localhost` and `http://127.0.0.1` still match their wildcard suffix.
- Non-matching origins receive `Vary: Origin` in the response.
- Credentialed `allowedHeaders: ["*"]` echoes `Access-Control-Request-Headers`.
- Compiling `["*"]` + credentials throws; existing configs still compile.

**Reviewer Checklist:**
- Wildcard scheme check does not break exact allowlist entries.
- `Vary: Origin` is not duplicated when the value is `*`.
- Echo fallback handles a missing request header.
- Compile-time rejection does not affect `config-vault-cors`.

**Verification Checks:**
- `npm run check`
- `npx tsx --test test/response-cors.test.ts test/response-cors-wildcard.test.ts`

**Commit:** `fix(cors): enforce https wildcards and credential-safe headers`

## Phase 2: compiler/runtime correctness

**Task Guide Input:** Repository change. Fix route-resolution correctness in the
gateway compiler and runtime. C1: an explicitly configured OPTIONS route must
run its origin; only a genuine CORS preflight, resolved via resolvePreflightRoute,
auto-answers 204. C2: store route methods uppercased and reject unknown method
tokens at compile time. C3: prefix matching must be segment-aware so `/api`
does not match `/apiary`. C4: sort compiled routes deterministically, exact
before prefix then longest path first, so config authoring order cannot change
routing. C9: throw on duplicate policy names. A2: add a comment documenting the
all-or-nothing config rejection contract.

**Goal:** Route matching is deterministic and method casing cannot create dead routes.

**Files:**
- Modify: `src/gateway/compiler.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `test/gateway-pipeline.test.ts`

**Tasks:**
1. Uppercase route method at compile time; validate the token against a known
   method set and throw otherwise.
2. Add a segment-aware prefix match helper and use it in `resolveRoute`.
3. Sort compiled routes: exact before prefix, then longest path first.
4. Change the OPTIONS short-circuit to run only when the route came from
   `resolvePreflightRoute`; thread a `isPreflight` flag through resolution.
5. Throw on duplicate policy names in `buildPolicyDefinitions`.
6. Document the all-or-nothing compile contract in a comment.
7. Add tests for method normalization, segment boundary, ordering, explicit
   OPTIONS origin routing, and duplicate policy rejection.

**Acceptance Criteria:**
- Config `"method": "get"` matches GET requests.
- Route `/api` no longer matches `/apiary/secret`.
- Reordering the two `/udemy/api` config entries does not change resolution.
- An explicit OPTIONS route reaches its origin; preflight still answers 204.
- Duplicate policy names fail compilation.

**Reviewer Checklist:**
- Sorting preserves today's config behavior (exact route still wins).
- Preflight detection still requires `access-control-request-method`.
- Unknown method tokens cannot silently compile to dead routes.

**Verification Checks:**
- `npm run check`
- `npx tsx --test test/gateway-pipeline.test.ts`

**Commit:** `fix(gateway): deterministic route matching and method normalization`

## Phase 3: origins

**Task Guide Input:** Repository change. Consolidate the two failover origin
handlers and fix origin performance and correctness. A1: merge proxyAll and
upstreamWithFallback into one parameterized handler with a shared module-level
health cache; proxyAll differs only by stripPrefix and originType. P1: buffer the
request body only for retryable methods and stream otherwise with duplex half.
P4: health checks must dedupe in-flight promises and serve last-known state
during refresh instead of blocking. C6: the url origin gains a configurable
timeout via AbortController and sets redirect manual.

**Goal:** One shared failover origin with no blocking health checks and streaming bodies.

**Files:**
- Modify: `src/origins/proxyAll.ts`
- Modify: `src/origins/upstreamWithFallback.ts`
- Modify: `src/origins/failover.ts`
- Modify: `src/origins/url.ts`
- Modify: `src/origins/index.ts`
- Modify: `test/origin-failover.test.ts`
- Modify: `test/origin-logging.test.ts`

**Tasks:**
1. Extract the shared health cache and health-status lookup into one module with
   in-flight promise dedupe and stale-while-revalidate serving.
2. Merge the two handlers into one parameterized implementation; keep both
   exported names as thin wrappers so the handler registry is unchanged.
3. In `failover.ts`, read the body only when `canRetry` is true; for streaming
   paths pass `request.body` with `duplex: "half"` to the upstream request.
4. Add timeout and `redirect: "manual"` to the `url` origin fetch.
5. Update tests for the shared cache, streaming non-retryable bodies, and the
   url timeout behavior.

**Acceptance Criteria:**
- `proxyAll` and `upstreamWithFallback` share one health cache instance.
- Concurrent cold-start requests fire one health check, not one each.
- POST/PUT/DELETE bodies are streamed, not fully buffered.
- GET/HEAD retry behavior is unchanged.
- `url` origin aborts after its timeout and does not follow redirects.

**Reviewer Checklist:**
- The merged handler preserves the stripPrefix branch exactly.
- Stale-while-revalidate never returns a poisoned healthy state permanently.
- `duplex: "half"` is set only when a body is actually streamed.
- No behavioral change for health check failure paths.

**Verification Checks:**
- `npm run check`
- `npx tsx --test test/origin-failover.test.ts test/origin-logging.test.ts`

**Commit:** `refactor(origins): consolidate failover handlers and stream bodies`

## Phase 4: config, logging, and perf

**Task Guide Input:** Repository change. Apply performance and observability
fixes. P2: gate info logs behind a GATEWAY_LOG_LEVEL env check defaulting to
info, always emit errors, drop duplicated origin start/completion logs in origin
handlers and the redundant analytics/scheduled log. P3: build the json-schema
Validator once per compiled policy via a WeakMap keyed on options.schema.
P5: run cold-start writeLkg through ctx.waitUntil instead of awaiting it on the
first response path. P6: pass cacheTtl 60 to LKG KV reads. P7: skip ConfigCat
cache writes when the value is byte identical to the last written value. C5:
both bare catch sites capture the error and populate reason in the log event.

**Goal:** Per-request log volume and cold-start latency drop, and 500s carry diagnostics.

**Files:**
- Modify: `src/gateway/logging.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `src/config/source.ts`
- Modify: `src/config/kv.ts`
- Modify: `src/policies/request/json-body-validation.ts`
- Modify: `test/origin-logging.test.ts`
- Modify: `test/config-kv.test.ts`

**Tasks:**
1. Add a `GATEWAY_LOG_LEVEL` env read to `emitGatewayLog`; suppress info below
   the threshold, always emit error.
2. Remove the duplicate origin started/completed logs from `url.ts` and the
   merged failover handler; drop the analytics/scheduled log.
3. Memoize the Validator per compiled policy options object.
4. Move the cold-start `writeLkg` call to `ctx.waitUntil`.
5. Add `{ cacheTtl: 60 }` to `readLkg`.
6. Guard `GatewayConfigCatCache.set` with a byte-identical last-written check.
7. Capture errors in the runtime and index catch blocks and set `reason`.
8. Add or update tests for log gating, KV write skipping, and error reason.

**Acceptance Criteria:**
- Info logs are suppressible via `GATEWAY_LOG_LEVEL`; errors always emit.
- A typical request logs fewer events with no duplicate origin lines.
- Validator is constructed once per compiled policy, not per request.
- Cold start does not await the LKG write before responding.
- Identical ConfigCat cache writes are skipped.
- 500 log events carry a `reason` string.

**Reviewer Checklist:**
- Log-level default preserves current info output for existing callers.
- `waitUntil` receives a real promise and the resolver still awaits on warm path.
- KV write guard is per-key and reset-safe.
- Validator memoization does not leak per-request state.

**Verification Checks:**
- `npm run check`
- `npx tsx --test test/origin-logging.test.ts test/config-kv.test.ts`

**Commit:** `perf(gateway): gate logs, cache validators, and trim KV writes`

## Phase 5: cleanups

**Task Guide Input:** Repository change. Apply the low-severity cleanup findings.
C7: parse basic-auth with /^Basic\s+(\S+)$/i. C8: comment the LKG read-then-write
race in writeLkg. S5: constant-time string comparison for basic-auth and auth0
key checks. S6: document that GET/HEAD/OPTIONS routes are auth-optional by design.
S7: document GATEWAY_API_KEY in the README secret list. S8: return a generic 400
from json-body-validation and log the detail. A3: document the origins-must-return
a-constructed-Response contract at the response-policy site. A4: attach minimal
CORS headers to the 503 unavailable path. P8: parse the request URL once in
executeGatewayRequest and thread it through. P9: remove the microtask wrapper
around logAnalytics, the double Response wraps in failover, the double request
clone in url, and hoist the GATEWAY_API_KEY split out of the request path.

**Goal:** Remaining findings closed without behavior changes beyond the fixes.

**Files:**
- Modify: `src/policies/request/basic-auth.ts`
- Modify: `src/policies/request/auth0-jwt.ts`
- Modify: `src/policies/request/json-body-validation.ts`
- Modify: `src/policies/response/add-headers.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `src/origins/failover.ts`
- Modify: `src/origins/url.ts`
- Modify: `src/config/kv.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `test/request-policies.test.ts`

**Tasks:**
1. Fix basic-auth header parsing with the case-insensitive single-space regex.
2. Add a constant-time compare helper and use it in basic-auth and auth0 key
   checks; hoist the GATEWAY_API_KEY split to a module-level memo.
3. Return a generic validation error message and emit the detail as a log.
4. Comment the LKG write race and the auth-optional read-route design.
5. Document GATEWAY_API_KEY in the README secret list.
6. Add CORS headers to the unavailable-gateway response and document the
   constructed-Response contract at the response-policy application site.
7. Parse the URL once in executeGatewayRequest; remove the microtask wrapper,
   the double Response wraps, and the double request clone.
8. Update tests for basic-auth casing and the generic validation message.

**Acceptance Criteria:**
- `basic dXNlcjpwYXNz` and double-spaced Basic headers parse correctly.
- Credential comparisons use the constant-time helper.
- Validation errors return a generic message; detail goes to logs.
- The 503 path carries CORS headers.
- `npm run check` passes with no warnings about removed code.

**Reviewer Checklist:**
- Constant-time helper handles length mismatch without leaking length.
- README secret list matches the actual worker vars.
- URL threading does not change route or origin URL behavior.
- No leftover references to removed helper usages.

**Verification Checks:**
- `npm run check`
- `npx tsx --test test/request-policies.test.ts`

**Commit:** `chore(gateway): apply low-severity cleanups and docs`
