## Original User Request

Replace the bundled `src/config.json` with a routing document sourced from
ConfigCat, validated and cached, with Workers KV as backing storage.

## Phase

Phase 3: `resolveGateway` returns a `CompiledGateway` or `undefined`, doing no
I/O on the steady-state path, with every candidate and refresh branch tested.

## Tasks

- task-1: Implement the resolver factory and its isolate-local state: `client`,
  `compiled`, `lastRaw`, `nextRefreshMs`, `refreshInFlight`, `generation`. The
  ConfigCat client is created inside the request path, because the KV binding
  arrives on `env`.
- task-2: Implement the candidate ladder, in order: ConfigCat value with a
  sentinel default, `lkg`, one bounded inline `forceRefreshAsync`, then an
  optional caller-supplied final candidate. Each candidate is parsed,
  schema-validated, and passed through `compileGateway` before acceptance. A
  candidate that fails any step logs at error level with its reason, and the
  ladder continues.
- task-3: Implement the refresh gate: serve `compiled` when
  `now() < nextRefreshMs`; skip scheduling when `refreshInFlight` is set; set
  `nextRefreshMs` when the refresh settles, to 60000 plus 0 to 15000 jitter on
  success and 5000 on failure; discard a refresh result whose captured
  `generation` is stale.
- task-4: Write `lkg` only from a fresh CDN refresh result that validated and
  compiled, never from a KV-sourced or final-candidate document. Log the adopted
  candidate and a short document hash on every successful resolution.

## Context

Verified facts, do not re-derive them.

SDK surface, read from the published `@configcat/sdk@1.1.0` typings:

- Import from the package root, `@configcat/sdk`. Do not use the
  `@configcat/sdk/cloudflare-worker` subpath: `tsconfig.json` sets
  `moduleResolution: "node"`, which ignores the package `exports` map, so the
  subpath fails to typecheck. I confirmed both halves of this empirically: the
  subpath import raises `TS2307`, and a root import both typechecks and bundles
  to the workerd build. A `wrangler deploy --dry-run` of a root import emitted
  `CloudflareConfigCache` and the fetch-API fetcher with zero `node:http`
  references, because wrangler applies the `workerd` export condition.
- `getClient(sdkKey, pollingMode?, options?): IConfigCatClient`, and
  `PollingMode.ManualPoll`.
- Client options relevant here: `cache?: IConfigCatCache | null` and
  `requestTimeoutMs?: number | null`.
- `getValueDetailsAsync<T>(key, defaultValue, user?)` resolves to
  `EvaluationDetails<T>` carrying `value`, `fetchTime?: Date`, and
  `isDefaultValue: boolean`. Prefer it over `getValueAsync`, since one call
  yields the value, the sentinel signal through `isDefaultValue`, and the
  timestamp `writeLkg` needs.
- `forceRefreshAsync(): Promise<RefreshResult>`.

Repository surface:

- `src/config/kv.ts`, from Phase 2, exports `GatewayConfigEnv`,
  `createConfigCatCache(env)`, `readLkg(env)` resolving to
  `{ version, raw, timestamp } | null`, and
  `writeLkg(env, raw, configTimestamp: Date | number | undefined)` resolving to
  a boolean. Key derivation throws when `GATEWAY_NAME` is unset.
- `src/config/schema.ts`, from Phase 1, exports `validateGatewayConfig(value)`
  returning `{ valid: true, config } | { valid: false, errors }`. It never
  throws.
- `compileGateway(config, handlers)` at `src/gateway/compiler.ts:60` throws on
  an unknown origin type, an unknown policy name, an unknown policy type, and
  any write method lacking an `auth0jwt` policy. Candidate acceptance therefore
  happens only after `compileGateway` returns, not after schema validation
  alone.
- `GatewayHandlers` at `src/gateway/types.ts:40` is
  `{ requestPolicies, responsePolicies, origins }`.
- `emitGatewayLog(logger, event)` at `src/gateway/logging.ts:21` falls back to
  `console.error` for `level: "error"` and `console.info` otherwise.
- `GatewayExecutionContext` at `src/gateway/types.ts:112` is
  `Pick<ExecutionContext, "waitUntil" | "passThroughOnException">`.
- `tsconfig.json` excludes `test/`, so `npm run typecheck` does not cover test
  files. `npm test` runs them through `tsx --test`.
- Test style: `node:test` plus `node:assert/strict`, with fakes injected as
  plain objects. See `test/config-kv.test.ts` and `test/gateway-pipeline.test.ts`.

Shape decisions I have already made. Implement these rather than inventing
alternatives.

- Export a factory, `createGatewayResolver()`, returning an object with a
  `resolve` method. State lives in the closure. Phase 4 creates one instance at
  module scope. A factory is required so tests get fresh state per case without
  a test-only reset export.
- Signature:
  ```ts
  resolve(
    env: GatewayConfigEnv & GatewayEnv & { CONFIGCAT_SDK_KEY?: string },
    ctx: GatewayExecutionContext,
    handlers: GatewayHandlers,
    dependencies?: ResolveGatewayDependencies,
  ): Promise<CompiledGateway | undefined>
  ```
  `handlers` is its own parameter, mirroring `compileGateway`, which already
  takes it that way.
- `ResolveGatewayDependencies` carries only injection points:
  `now?: () => number`, `random?: () => number`, `logEvent?: GatewayLogger`,
  `getClient?: (env) => IConfigCatClient`, and
  `finalCandidate?: unknown`. `finalCandidate` is the caller-supplied last rung,
  which Phase 4 fills with the imported `src/config.json`. It is deliberately
  not the `getValueAsync` default, so a cache miss stays distinguishable from a
  real ConfigCat value.
- Constants: flag key `gateway_config`; refresh interval 60000; jitter ceiling
  15000; failure backoff 5000. Choose a sentinel string that cannot collide with
  a real document.
- The short document hash is a small deterministic non-cryptographic hash, FNV-1a
  over the raw string rendered as hex, computed synchronously. Do not reach for
  `crypto.subtle`, which is async and unnecessary for a log field.
- Candidate names, used verbatim in logs: `configcat`, `lkg`, `inline-refresh`,
  `bundled`.
- The cold-start ladder runs under the same `refreshInFlight` guard as the
  background refresh. A concurrent caller on a cold isolate awaits the in-flight
  promise and then returns whatever `compiled` holds, rather than starting a
  second ladder. This is what makes the concurrency criterion below true.
- `refreshInFlight` is cleared in a `finally`, so a throw cannot deadlock the
  gate.

You may modify `src/gateway/types.ts` for exactly one purpose: `GatewayLogEvent`
has no field able to carry the adopted candidate, the document hash, or a
rejection reason, and its `method` is required, which a resolver with no request
in hand cannot supply. Add optional `configSource`, `configHash`, and `reason`
fields, and make `method` optional. No existing test asserts on `method`. Change
nothing else in that file, and change no other shared file.

## Files

- Create: `src/config/source.ts`
- Create: `test/config-source.test.ts`
- Modify: `src/gateway/types.ts`, only as described above

`src/index.ts`, `src/config.json`, `src/config/kv.ts`, `src/config/schema.ts`,
`src/gateway/compiler.ts`, `src/gateway/runtime.ts`, and `wrangler.toml` stay
unchanged. Phase 4 does the wiring.

## Done When

- A warm isolate inside the refresh window performs no value read, KV read, or
  fetch, verified by asserting zero calls on injected fakes.
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
- Jitter uses a bounded range and cannot produce a negative or zero interval.
- `npm run typecheck`
- `npm test`

Drive time through the injected `now` and jitter through the injected `random`.
Do not use real timers or sleeps in tests.

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's
`notes.md` and `journal.md`.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
