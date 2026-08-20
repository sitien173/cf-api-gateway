# Apply Code Review Findings Plan

## Objective

Apply every confirmed review correction. Add regression coverage. Preserve GET compatibility. Require Auth0 JWT for every mutation route.

## Scope

The plan covers tooling, CI, generated artifacts, logging, analytics, failover, authentication, validation, response helpers, types, naming, and documentation.

## Confirmed Decisions

- Use focused safety stabilization.
- Read Auth0 values from Worker bindings.
- Protect every mutation route with Auth0 JWT.
- Retry only `GET` and `HEAD` requests.
- Remove tracked `dist/` artifacts.
- Generate bundles during CI and releases.

### Phase 1: Establish Reproducible Quality Gates

**Task Guide Input:** Add a supported TypeScript test command, current patched Wrangler tooling, CI checks, and generated-artifact policy. Remove tracked `dist/` output without changing runtime behavior.

**Goal:** Make every later phase independently verifiable.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `worker-configuration.d.ts`
- Create: `.github/workflows/ci.yml`
- Delete: `dist/README.md`
- Delete: `dist/index.js`
- Delete: `dist/index.js.map`

**Tasks:**

1. Add `tsx` and update Wrangler safely.
2. Add `test`, `typecheck`, and `check` scripts.
3. Add CI compilation, tests, audit, and bundling.
4. Remove tracked bundles and document generation.

**Acceptance Criteria:**

- `npm test` executes every committed test.
- `npm run check` type-checks source and runs tests.
- Full audit reports no high vulnerabilities.
- CI creates a dry-run bundle successfully.
- `dist/` contains no tracked files.
- README commands match package scripts.

**Reviewer Checklist:**

- Verify the runner follows current `tsx` documentation.
- Verify CI uses current official action versions.
- Verify dependency changes remain development-only.
- Verify generated files cannot re-enter commits accidentally.

**Verification Checks:**

- `npm ci`
- `npm run check`
- `npm run types:check`
- `npm audit --audit-level=high`
- `npm run bundle`
- `git ls-files dist`
- `git diff --check`

**Commit:** `build: establish gateway quality gates`

### Phase 2: Remove Sensitive Telemetry And Write Analytics

**Task Guide Input:** Replace request-detail logging with metadata-only events. Write Analytics Engine datapoints without reading response bodies. Preserve current SQL column positions and gateway execution behavior.

**Goal:** Prevent telemetry disclosure and restore analytics delivery.

**Files:**

- Modify: `src/gateway/logging.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/services/analytics.ts`
- Modify: `src/index.ts`
- Modify: `src/origins/url.ts`
- Modify: `src/origins/proxyAll.ts`
- Modify: `src/origins/upstreamWithFallback.ts`
- Modify: `test/gateway-pipeline.test.ts`
- Modify: `test/origin-logging.test.ts`
- Create: `test/analytics.test.ts`

**Tasks:**

1. Add failing secret-omission logging tests.
2. Reduce log events to approved metadata.
3. Add failing Analytics Engine write tests.
4. Write typed datapoints without body buffering.

**Acceptance Criteria:**

- Logs contain no headers or query values.
- Logs contain no raw target URLs.
- Error logs expose stable categories only.
- Analytics writes exactly one datapoint per response.
- Datapoints preserve documented SQL positions.
- Analytics never clones or reads response bodies.
- Route misses use a fixed analytics route label.

**Reviewer Checklist:**

- Search every log construction for request-derived secrets.
- Verify route templates replace raw request paths.
- Verify response streams remain untouched.
- Verify analytics failures remain background failures.

**Verification Checks:**

- `npm test`
- `npm run typecheck`
- `npm run bundle`
- `tgrep -n -e 'targetUrl' -e 'errorMessage' src/gateway src/origins src/services`
- `git diff --check`

**Commit:** `fix(observability): remove secrets and write analytics`

### Phase 3: Make Failover Safe And Shared

**Task Guide Input:** Consolidate duplicated failover logic. Prevent repeated mutation requests. Preserve direct fallback after unhealthy primary checks, path rewriting, redirects, bodies, and response semantics.

**Goal:** Guarantee at most one mutation attempt.

**Files:**

- Create: `src/origins/failover.ts`
- Modify: `src/origins/proxyAll.ts`
- Modify: `src/origins/upstreamWithFallback.ts`
- Modify: `test/origin-logging.test.ts`
- Create: `test/origin-failover.test.ts`

**Tasks:**

1. Add failing mutation non-replay tests.
2. Extract one internal failover executor.
3. Restrict retries to `GET` and `HEAD`.
4. Clear timers and normalize redirect handling.

**Acceptance Criteria:**

- GET and HEAD can retry fallback once.
- POST, PUT, PATCH, and DELETE never retry.
- Unhealthy routing sends mutations to one fallback.
- Mutation transport failures return HTTP 503.
- Primary mutation responses preserve their status.
- Every timeout clears after every outcome.
- Redirect handling stays manual across branches.
- Both public origin exports retain their signatures.

**Reviewer Checklist:**

- Count fetch calls across every mutation scenario.
- Verify ambiguous failures cannot duplicate writes.
- Verify every request body reaches one upstream only.
- Verify wrapper-specific path behavior remains unchanged.
- Verify abandoned response bodies release resources.

**Verification Checks:**

- `npm test`
- `npm run typecheck`
- `npm run bundle`
- `tgrep -n -e 'setTimeout' -e 'clearTimeout' src/origins`
- `git diff --check`

**Commit:** `fix(origins): prevent unsafe failover replays`

### Phase 4: Enforce Auth0 Mutation Authentication

**Task Guide Input:** Read Auth0 issuer and audience from Worker bindings. Cache remote JWK sets. Pass environment bindings into request policies. Require Auth0 JWT on every mutation route while preserving public GET routes.

**Goal:** Make every mutation route fail closed.

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `src/policies/request/auth0-jwt.ts`
- Modify: `src/config.json`
- Modify: `src/index.ts`
- Modify: `worker-configuration.d.ts`
- Modify: `README.md`
- Modify: `test/gateway-pipeline.test.ts`
- Create: `test/auth0-jwt.test.ts`

**Tasks:**

1. Add typed Auth0 Worker bindings.
2. Pass environment bindings into request policies.
3. Cache normalized remote JWK sets.
4. Protect and validate every mutation route.

**Acceptance Criteria:**

- Missing Auth0 bindings produce HTTP 500.
- Missing or invalid tokens produce HTTP 401.
- Valid tokens reach the selected origin.
- Remote JWK sets persist across requests.
- Every unsafe configured method uses Auth0 JWT.
- Compilation rejects unprotected mutation routes.
- GET routes remain public.
- OPTIONS preflight remains unauthenticated.
- No Auth0 deployment value enters Git.

**Reviewer Checklist:**

- Verify issuer and audience validation remain mandatory.
- Verify JWKS URL normalization handles trailing slashes.
- Verify authentication failures never log tokens.
- Verify configuration cannot bypass mutation protection.
- Verify production deployment requires both bindings.

**Verification Checks:**

- `npm test`
- `npm run typecheck`
- `npm run types:check`
- `npm run bundle`
- `tgrep -n '"request": \[\]' src/config.json`
- `git diff --check`

**Commit:** `feat(auth): require JWT for mutation routes`

### Phase 5: Correct Remaining Types And Edge Cases

**Task Guide Input:** Fix reviewed validation, response-header, identity-preservation, typing, naming, and spelling defects. Avoid unrelated refactoring.

**Goal:** Close every remaining review finding.

**Files:**

- Modify: `src/helpers/response.ts`
- Modify: `src/policies/request/json-body-validation.ts`
- Modify: `src/policies/request/change-method.ts`
- Modify: `src/policies/request/basic-auth.ts`
- Modify: `src/types/index.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `test/gateway-pipeline.test.ts`
- Create: `test/request-policies.test.ts`
- Create: `test/response-helpers.test.ts`

**Tasks:**

1. Add failing edge-case regression tests.
2. Return HTTP 400 for schema mismatches.
3. Preserve identity and merge response headers.
4. Tighten types and correct reviewed names.

**Acceptance Criteria:**

- Every JSON client-validation failure returns HTTP 400.
- JSON responses retain caller headers and content type.
- Method changes preserve authenticated identity.
- GET and HEAD method changes remove request bodies.
- Public source types expose no avoidable `any` values.
- Reviewed naming and spelling defects are corrected.
- No unrelated formatting changes appear.

**Reviewer Checklist:**

- Test object, tuple, and `Headers` initializers.
- Test missing schemas and malformed option values.
- Verify method conversion follows Fetch constraints.
- Verify type changes preserve handler compatibility.
- Verify only reviewed defects receive corrections.

**Verification Checks:**

- `npm test`
- `npm run check`
- `npm run types:check`
- `npm audit --audit-level=high`
- `npm run bundle`
- `tgrep -n -e ': any' -e '<any>' src`
- `git diff --check`

**Commit:** `fix: close gateway review findings`

### Phase 6: Verify Release Readiness

**Task Guide Input:** Perform final repository verification. Confirm security invariants, documentation accuracy, CI coverage, dependency health, and clean generated-artifact policy. Change only defects found by these checks.

**Goal:** Produce fresh release evidence for every finding.

**Files:**

- Modify if required: files changed during Phases 1 through 5
- Modify if required: `README.md`

**Tasks:**

1. Run the complete verification suite.
2. Audit every original finding against current code.
3. Reconcile README and deployment requirements.
4. Obtain independent specification and quality reviews.

**Acceptance Criteria:**

- Every original finding has passing evidence.
- All tests and type checks pass freshly.
- Production and full audits satisfy policy.
- Dry-run bundling succeeds without tracked output.
- CI covers the same required commands.
- Documentation states Auth0 deployment requirements.
- Independent reviews report no blocking findings.

**Reviewer Checklist:**

- Reproduce each original failure scenario.
- Inspect all mutation routes and retry branches.
- Search telemetry for secret-bearing fields.
- Confirm the root contains no generated drift.
- Confirm unrelated user files remain untouched.

**Verification Checks:**

- `npm ci`
- `npm run check`
- `npm run types:check`
- `npm audit --omit=dev --audit-level=high`
- `npm audit --audit-level=high`
- `npm run bundle`
- `git ls-files dist`
- `git diff --check`
- `git status --short`

**Commit:** `chore: verify gateway hardening release`

## Completion Standard

No phase completes without fresh verification. Each phase requires specification review and independent quality review. Correctness or security findings block progression.
