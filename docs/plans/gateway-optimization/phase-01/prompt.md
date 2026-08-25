## Original User Request
Apply the 27 cf-api-gateway optimization findings. Phase 1 of 5 fixes the CORS findings S1-S4.

## Phase
CORS policy handling is secure and spec-correct without editing src/config.json.

## Tasks
- task-1: In `findAllowedOrigin`, require `https:` for wildcard suffix matches, with `http://localhost` and `http://127.0.0.1` as explicit dev exceptions. Exact allowlist entries unchanged.
- task-2: Append `Vary: Origin` when `allowedOrigins` is not exactly `["*"]`, before the match-result branch, so non-matching origins also get it.
- task-3: When `allowCredentials` is true and `allowedHeaders` is `["*"]`, echo the request `Access-Control-Request-Headers` value instead of emitting `*`, falling back to `*` when the request header is absent.
- task-4: In `compileGateway`, reject any cors policy whose options combine `allowedOrigins` containing `*` with `allowCredentials: true`.
- task-5: Add tests for http wildcard rejection, localhost exception, non-matching Vary, header echo with credentials, and compile-time rejection.

## Context
Files and current behavior:

`src/policies/response/cors.ts` — `findAllowedOrigin` compares only hostname for `*.suffix` wildcards, so `http://evil.udemy.com` matches `*.udemy.com` and is echoed with credentials. `Vary: Origin` is appended only when an origin matched and the value is not `*`. `allowedHeaders: ["*"]` is emitted literally even when `allowCredentials` is true, which browsers reject for credentialed preflights.

`src/gateway/compiler.ts` — `compileGateway` builds routes from config. `buildPolicyDefinitions` maps policy name to config. Add a validation pass over compiled policies or during compilation: if a policy of type `cors` has `allowedOrigins` containing `*` and `allowCredentials` true, throw.

`test/response-cors.test.ts` and `test/response-cors-wildcard.test.ts` — existing CORS tests use the `cors` handler directly with constructed Requests and Responses.

## Files
- `src/policies/response/cors.ts`
- `src/gateway/compiler.ts`
- `test/response-cors.test.ts`
- `test/response-cors-wildcard.test.ts`

## Done When
- `http://evil.udemy.com` does not match `*.udemy.com`; `http://localhost` and `http://127.0.0.1` still match.
- Non-matching origins receive `Vary: Origin`.
- Credentialed `allowedHeaders: ["*"]` echoes `Access-Control-Request-Headers`.
- Compiling `["*"]` + credentials throws; existing configs still compile.
- `npm run check` passes.

## Rules
Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
