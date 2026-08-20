# Apply Code Review Findings Design

## Purpose

Resolve every confirmed review finding. Preserve existing public GET behavior. Make mutation routes fail closed through Auth0 JWT.

## Selected Approach

Use focused safety stabilization. Preserve current route and handler concepts. Refactor only duplicated or unsafe implementation paths.

## Security Boundaries

- Protect every non-safe route with Auth0 JWT.
- Treat `GET`, `HEAD`, and `OPTIONS` as safe methods.
- Read `AUTH0_ISSUER` and `AUTH0_AUDIENCE` from Worker bindings.
- Return HTTP 500 when required Auth0 bindings are absent.
- Return HTTP 401 for invalid or expired tokens.
- Never commit Auth0 deployment values.
- Remove headers, query values, and target URLs from logs.
- Replace raw exception messages with stable error categories.

The compiler rejects mutation routes without an Auth0 policy. Current GET routes remain public. CORS remains a response policy only.

## Failover Behavior

Both failover origins use one internal executor.

- An unhealthy primary routes any request directly to fallback.
- This health decision produces exactly one mutation attempt.
- A selected primary can retry only `GET` or `HEAD`.
- Mutation transport failures return HTTP 503.
- Mutation primary responses preserve their original status.
- Redirect handling stays manual across every branch.
- Health timers always clear through `finally`.

Path stripping and redirect rewriting remain wrapper-specific behavior.

## Logging And Analytics

Gateway logs contain operational metadata only:

- stage
- outcome
- method
- matched route template
- origin type
- policy name
- status
- latency
- stable error category

Logs omit raw paths, queries, headers, and target URLs.

Analytics Engine receives this stable layout:

- `index1`: gateway name
- `blob1`: matched route template
- `blob2`: request method
- `double1`: response status
- `double2`: latency milliseconds

Unmatched requests use a fixed route label. Analytics never reads response bodies.

## Type And Lifecycle Corrections

- Define Worker bindings through one `GatewayEnv` type.
- Pass that environment into request policies.
- Cache remote JWK sets by normalized issuer.
- Preserve authenticated identity across method changes.
- Merge `JsonResponse` headers through `Headers`.
- Return HTTP 400 for every client validation failure.
- Replace exposed `any` values with bounded domain types.
- Correct reviewed naming and spelling defects.

## Tooling And Artifacts

- Use `tsx --test` for TypeScript tests.
- Add `test`, `typecheck`, and `check` scripts.
- Update Wrangler within major version 4.
- Require full dependency audits in CI.
- Remove tracked `dist/` artifacts.
- Generate dry-run bundles only during CI and releases.

## Migration

Production must define both Auth0 bindings first. Deploy the code only after binding validation. Mutation callers must send valid bearer tokens. Existing GET callers require no migration.

Logging consumers must stop depending on raw request data. Analytics queries retain their current column positions.

## Testing Strategy

Each behavior change starts with a failing regression test. Tests cover secret omission, analytics writes, safe failover, mutation non-replay, Auth0 enforcement, JWKS reuse, timer cleanup, response headers, validation status, and identity preservation.

Final checks include TypeScript compilation, Worker type validation, tests, audits, dry-run bundling, and independent review.

## Non-Goals

- No Cloudflare Access rollout.
- No endpoint-specific mutation retry opt-ins.
- No route configuration format redesign.
- No unrelated README rewrite.
