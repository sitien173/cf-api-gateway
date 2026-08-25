# Design: cf-api-gateway optimization

Status: confirmed, not yet implemented
Date: 2026-08-25
Source: B-001, consult job 6b91334b-af93-4880-8bee-ff91ba6bec77

## Summary

Apply the 27 findings from the repository optimization consultation. Work is
split into five module-based phases, each independently reviewed and committed.
Every finding is addressed: 9 performance, 9 correctness, 8 security, 4
architecture, with three accepted as document-only.

## Goals

- Remove recurring per-request and per-minute costs: body buffering for
  non-retryable methods, unconditional verbose logging, ConfigCat cache writes,
  per-request Validator construction, blocking health checks.
- Close the security gaps in CORS policy handling.
- Fix route-resolution correctness so config order and method casing cannot
  produce silently wrong routing.
- Consolidate the two nearly identical origin handlers into one implementation.
- Keep all 63 existing tests passing and add coverage for changed behavior.

## Non-goals

- New features, new policies, or new origin types.
- Editing `src/config.json` to change deployed routing or CORS policy.
- Touching generated files: `worker-configuration.d.ts`, `dist/`.
- Config-file structural changes to `src/config/schema.ts` beyond what a finding
  requires.

## User decisions

1. Scope: all 27 findings, including the A1 consolidation.
2. CORS scheme fix (S1): enforce https for wildcard matches, with explicit
   `http://localhost` and `http://127.0.0.1` exceptions for local dev.
3. CORS config fixes (S2, S4): code-level only. Reject bad combinations at
   compile time and echo `Access-Control-Request-Headers` when `allowedHeaders`
   is `["*"]` with credentials. No `src/config.json` edits.
4. Phasing: five module phases.

## Phase breakdown

### Phase 1: CORS bundle

Files: `src/policies/response/cors.ts`, `src/gateway/compiler.ts`.

- S1: `findAllowedOrigin` requires `https:` for wildcard suffix matches, except
  `http://localhost` and `http://127.0.0.1`. Exact allowlist entries keep
  current behavior.
- S2: `compileGateway` rejects a `cors` policy whose options set
  `allowedOrigins: ["*"]` with `allowCredentials: true`.
- S3: `Vary: Origin` is appended whenever `allowedOrigins` is not exactly
  `["*"]`, including the non-matching case.
- S4: when `allowedHeaders` is `["*"]` and `allowCredentials` is true, echo the
  request `Access-Control-Request-Headers` value instead of `*`.

### Phase 2: compiler/runtime correctness

Files: `src/gateway/compiler.ts`, `src/gateway/runtime.ts`.

- C1: an explicitly configured `OPTIONS` route runs its origin; only a genuine
  preflight, resolved via `resolvePreflightRoute`, auto-answers 204.
- C2: compiled routes store `route.method.toUpperCase()`; unknown method tokens
  are rejected at compile time.
- C3: prefix matching is segment-aware: a match requires
  `pathname === path || pathname.startsWith(path.endsWith("/") ? path : path + "/")`.
- C4: routes are sorted deterministically at compile time: exact before prefix,
  then longest path first. Behavior no longer depends on config authoring order.
- C9: duplicate policy names throw at compile time.
- A2: document the all-or-nothing config rejection contract in a comment at the
  compile step; no behavior change.

### Phase 3: origins

Files: `src/origins/proxyAll.ts`, `src/origins/upstreamWithFallback.ts`,
`src/origins/failover.ts`, `src/origins/url.ts`, `src/origins/index.ts`.

- A1: merge `proxyAll` and `upstreamWithFallback` into one parameterized handler
  sharing one module-level health cache; `proxyAll` differs only by
  `stripPrefix` and `originType`.
- P1: `failover.ts` buffers the request body only when `canRetry` is true;
  non-retryable methods stream `request.body` to the upstream with
  `duplex: "half"`.
- P4: health-check cache stores in-flight promises and serves last-known state
  while a refresh runs, so health checks never block a response.
- C6: the `url` origin gains a configurable timeout via `AbortController` and
  sets `redirect: "manual"`, mirroring the failover origins.

### Phase 4: config, logging, and perf

Files: `src/gateway/logging.ts`, `src/gateway/runtime.ts`,
`src/config/source.ts`, `src/config/kv.ts`,
`src/policies/request/json-body-validation.ts`.

- P2: `emitGatewayLog` gates `info` output behind a `GATEWAY_LOG_LEVEL` env
  check with default `info`; `error` always emits. Duplicated origin start and
  completion logs in origin handlers are removed; the runtime keeps one pair.
  The redundant `analytics/scheduled` log is dropped.
- P3: `json-body-validation` builds the `Validator` once per compiled policy via
  a WeakMap keyed on `options.schema`, populated at compile time.
- P5: cold-start `writeLkg` runs through `ctx.waitUntil` instead of awaiting the
  KV read and put on the first response path.
- P6: `readLkg` passes `{ cacheTtl: 60 }` to the KV read.
- P7: `GatewayConfigCatCache.set` skips the `put` when the value is byte
  identical to the last written value for that key.
- C5: both bare `catch {}` sites capture the error and populate `reason` in the
  emitted log event.

### Phase 5: cleanups

Files: `src/policies/request/basic-auth.ts`,
`src/policies/request/auth0-jwt.ts`, `src/policies/request/json-body-validation.ts`,
`src/policies/response/add-headers.ts`, `src/gateway/runtime.ts`,
`src/gateway/compiler.ts`, `src/origins/failover.ts`, `src/origins/url.ts`,
`src/config/kv.ts`, `src/index.ts`, `README.md`.

- C7: `basic-auth` parses the header with `/^Basic\s+(\S+)$/i`, mirroring
  `auth0-jwt`.
- C8: add a comment to `writeLkg` documenting the read-then-write race and why
  it is accepted.
- S5: add a constant-time string comparison helper and use it in `basic-auth`
  and `auth0-jwt` key comparison.
- S6: document in `compiler.ts` that GET/HEAD/OPTIONS routes are auth-optional by
  design.
- S7: document `GATEWAY_API_KEY` in the README secret list.
- S8: `json-body-validation` returns a generic 400 message; validation detail
  goes to the log.
- A3: document the "origins must return a constructed Response" contract at the
  response-policy application site.
- A4: attach minimal CORS headers to the 503 unavailable-gateway path.
- P8: parse the request URL once in `executeGatewayRequest` and thread it through.
- P9: remove the redundant microtask wrapper around `logAnalytics`, the double
  `Response` wraps in failover paths, the double request clone in `url`, and
  hoist the `GATEWAY_API_KEY` split out of the request path.

## Testing

All phases run `npm run check` (typecheck + 63 tests). Each phase adds tests for
the behavior it changes: CORS matching and header output, route normalization
and ordering, origin consolidation and body buffering, log-level gating, KV
write skipping, and the cleanup fixes.

## Risks

- A1 touches the two most complex origin files; the shared health cache and
  `stripPrefix` branch are the sensitive points. Existing origin tests in
  `test/origin-failover.test.ts` and `test/origin-logging.test.ts` cover most
  behavior.
- C4 route reordering could change routing if the current config accidentally
  relied on order; `src/config.json` has the exact route before the prefix route,
  so the deterministic sort preserves today's behavior.
- S1 wildcard https enforcement breaks plain-http non-local dev origins under
  `*.udemy.com` or `*.hcmc.online`; this is the intended fix.
