## Original User Request

Continue the active ConfigCat configuration-source plan.

## Phase

Wire asynchronous ConfigCat gateway resolution into the Worker.

## Tasks

- Replace module-scope gateway compilation with one isolate-local resolver.
- Await resolution in `fetch`, using bundled `config.json` as final candidate.
- Route resolution failure through existing finalization with `ErrorResponse` 503.
- Add `CONFIGCAT_SDK_KEY` and `GATEWAY_CONFIG` bindings.
- Bind `GATEWAY_CONFIG` to KV namespace `c101ca543a654b0dbeb6a227fbede546`.
- Ignore `.dev.vars`.
- Add only the requested 503 regression coverage.

## Context

`createGatewayResolver().resolve` accepts the Worker environment, execution
context, gateway handler modules, and a `finalCandidate`. `executeGatewayRequest`
already finalizes matched and route-miss responses. Preserve its analytics and
logging path by using its finalization mechanism rather than returning a bare
response. `src/config.json` remains the deploy-1 fallback.

## Files

- `src/index.ts`
- `wrangler.toml`
- `.gitignore`
- `test/gateway-pipeline.test.ts`

## Done When

- `src/config.json` remains imported and present.
- No resolved configuration returns a finalized `ErrorResponse` with status 503.
- The 503 regression proves analytics and a finalization log event occur.
- `wrangler.toml` contains no secret value.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run bundle` passes.

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's
`notes.md` and `journal.md`.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
