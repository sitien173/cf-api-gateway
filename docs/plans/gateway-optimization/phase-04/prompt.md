## Original User Request
Apply the 27 cf-api-gateway optimization findings. Phase 4 of 5 applies performance and observability fixes P2, P3, P5, P6, P7, C5.

## Phase
Per-request log volume and cold-start latency drop, and 500s carry diagnostics.

## Tasks
- task-1: Add a `GATEWAY_LOG_LEVEL` env read to `emitGatewayLog`; suppress info below the threshold, always emit error.
- task-2: Remove the duplicate origin started/completed logs from `url.ts` and the shared failover origin; drop the analytics/scheduled log from `runtime.ts`.
- task-3: Memoize the Validator per compiled policy options object in `json-body-validation.ts`.
- task-4: Move the cold-start `writeLkg` call to `ctx.waitUntil` in `config/source.ts`.
- task-5: Add `{ cacheTtl: 60 }` to `readLkg` in `config/kv.ts`.
- task-6: Guard `GatewayConfigCatCache.set` with a byte-identical last-written check in `config/kv.ts`.
- task-7: Capture errors in the runtime and index catch blocks and set `reason`.
- task-8: Add or update tests for log gating, KV write skipping, and error reason.

## Context
Current behavior:

`src/gateway/logging.ts` — `emitGatewayLog` logs everything at info with no level filter. `GatewayLogLevel` is `"info" | "error"`. `GatewayEnv` has `[key: string]: any`, so a `GATEWAY_LOG_LEVEL` env read needs no new type. Default must remain `info` so current output is preserved.

`src/origins/url.ts:45-60` logs origin started/completed; `runtime.ts:227-244` logs the same pair for the same origin call. Drop the origin handlers' pair, keep the runtime's. `runtime.ts:91-98` emits analytics/scheduled, redundant with response_finalization two lines later.

`src/policies/request/json-body-validation.ts` — `new Validator(options.schema)` runs per request. Memoize via a module-level `WeakMap<object, Validator>` keyed on `options.schema`; `options` object identity is stable across requests.

`src/config/source.ts:364` — on cold inline-refresh, `await writeLkg(...)` runs before the first response. Change to `ctx.waitUntil(writeLkg(...))`; `resolve` already receives `ctx`.

`src/config/kv.ts` — `readLkg` calls `env.GATEWAY_CONFIG.get(key)` with no options; add `{ cacheTtl: 60 }`. `GatewayConfigCatCache.set` always puts; add an in-instance `lastWritten` map and skip the put when the value is byte-identical.

`src/gateway/runtime.ts:262` and `src/index.ts:96` are bare `catch {}`. `GatewayLogEvent` has a `reason` field. `src/config/source.ts:108` has an `errorMessage` helper.

Tests: `test/origin-logging.test.ts` and `test/config-kv.test.ts` exist.

## Files
- `src/gateway/logging.ts`
- `src/gateway/runtime.ts`
- `src/config/source.ts`
- `src/config/kv.ts`
- `src/policies/request/json-body-validation.ts`
- `test/origin-logging.test.ts`
- `test/config-kv.test.ts`

## Done When
- Info logs are suppressible via `GATEWAY_LOG_LEVEL`; errors always emit.
- A typical request logs fewer events with no duplicate origin lines.
- Validator is constructed once per compiled policy, not per request.
- Cold start does not await the LKG write before responding.
- Identical ConfigCat cache writes are skipped.
- 500 log events carry a `reason` string.
- `npm run check` passes.

## Rules
Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
