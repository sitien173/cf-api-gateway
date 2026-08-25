## Original User Request
Apply the 27 cf-api-gateway optimization findings. Phase 5 of 5 applies the low-severity cleanups C7, C8, S5, S6, S7, S8, A3, A4, P8, P9.

## Phase
Remaining findings closed without behavior changes beyond the fixes.

## Tasks
- task-1: Fix basic-auth header parsing with a case-insensitive single-token regex mirroring auth0-jwt.
- task-2: Add a constant-time compare helper and use it in basic-auth and auth0-jwt key checks; hoist the GATEWAY_API_KEY split to a module-level memo.
- task-3: Return a generic validation error message from json-body-validation and emit the detail as a log.
- task-4: Comment the LKG write race in writeLkg and the auth-optional read-route design in compiler.ts.
- task-5: Document GATEWAY_API_KEY in the README secret list.
- task-6: Add CORS headers to the unavailable-gateway response and document the constructed-Response contract at the response-policy application site.
- task-7: Parse the URL once in executeGatewayRequest; remove the microtask wrapper around logAnalytics, the double Response wraps in failover, and the double request clone in url.ts.
- task-8: Update tests for basic-auth casing and the generic validation message.

## Context
Current behavior:

`src/policies/request/basic-auth.ts` — `authHeader.split(" ")` breaks on double spaces; `authenticationType !== 'Basic'` is case-sensitive. `auth0-jwt.ts` has the right pattern: `/^Bearer\s+(\S+)$/i`.

`src/policies/request/auth0-jwt.ts:53-58` — `GATEWAY_API_KEY` is split/trimmed/filtered on every request. Hoist to a module-level memo keyed on the raw string. Credential comparison uses `.includes` and `btoa(...) !==`; add a constant-time compare helper (XOR-accumulate over equal-length buffers, length-mismatch returns false).

`src/policies/request/json-body-validation.ts:25-28` — returns `"Could not validate body against schema. " + result.errors[0].error`, exposing schema internals. Return a generic message; log the detail.

`src/config/kv.ts:120-128` — writeLkg does a read-then-write that is not atomic; add a comment explaining the race and why it is accepted.

`src/gateway/compiler.ts:81` — GET/HEAD/OPTIONS routes are auth-optional by design; add a comment.

`src/gateway/runtime.ts:35-59` — response policies mutate headers in place; add a comment documenting the "origins must return a constructed Response" contract.

`src/index.ts:34-48` — createUnavailableGateway has `responsePolicies: []`, so the 503 has no CORS headers. Add a minimal permissive-read CORS header set or an inline response policy.

`src/gateway/runtime.ts:20` and origin handlers parse the URL multiple times per request; parse once in executeGatewayRequest and thread it through where cheap. `runtime.ts:105-107` wraps `logAnalytics` in `Promise.resolve().then(...)`; call it directly. `failover.ts` builds two Response objects in fallback paths; `url.ts:43` clones the request twice; reduce where safe.

`README.md` secret setup section documents AUTH0_ISSUER/AUTH0_AUDIENCE but not GATEWAY_API_KEY.

Tests: `test/request-policies.test.ts` exists.

## Files
- `src/policies/request/basic-auth.ts`
- `src/policies/request/auth0-jwt.ts`
- `src/policies/request/json-body-validation.ts`
- `src/policies/response/add-headers.ts`
- `src/gateway/runtime.ts`
- `src/gateway/compiler.ts`
- `src/origins/failover.ts`
- `src/origins/url.ts`
- `src/config/kv.ts`
- `src/index.ts`
- `README.md`
- `test/request-policies.test.ts`

## Done When
- `basic dXNlcjpwYXNz` and double-spaced Basic headers parse correctly.
- Credential comparisons use the constant-time helper.
- Validation errors return a generic message; detail goes to logs.
- The 503 path carries CORS headers.
- README documents GATEWAY_API_KEY.
- `npm run check` passes.

## Rules
Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
