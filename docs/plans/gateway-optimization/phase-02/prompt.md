## Original User Request
Apply the 27 cf-api-gateway optimization findings. Phase 2 of 5 fixes route-resolution correctness C1-C4, C9, A2.

## Phase
Route matching is deterministic and method casing cannot create dead routes.

## Tasks
- task-1: Uppercase route method at compile time; validate the token against a known HTTP method set and throw otherwise.
- task-2: Add a segment-aware prefix match helper and use it in `resolveRoute`.
- task-3: Sort compiled routes deterministically: exact before prefix, then longest path first.
- task-4: Change the OPTIONS short-circuit to run only when the route came from `resolvePreflightRoute`; thread an `isPreflight` flag through resolution.
- task-5: Throw on duplicate policy names in `buildPolicyDefinitions`.
- task-6: Document the all-or-nothing compile contract in a comment.
- task-7: Add tests for method normalization, segment boundary, ordering, explicit OPTIONS origin routing, and duplicate policy rejection.

## Context
Current behavior:

`src/gateway/compiler.ts` — `compileGateway` stores `route.method` verbatim (line 92). The auth check normalizes with `toUpperCase()` but matching in `runtime.ts` uses exact `!==`. So `"method": "get"` compiles and then never matches. `resolveMatchMode` forces `prefix` for `proxyAll` regardless of path, and `normalizeRoutePath` only appends a boundary slash when the path ends in `/*`; a `proxyAll` route with path `/api` compiles to prefix `/api`, and `startsWith("/api")` matches `/apiary/secret`. `buildPolicyDefinitions` uses `policyMap.set` with no collision check. Routes are matched in config order via `routes.find`, so behavior depends on authoring order.

`src/gateway/runtime.ts` — `resolveRoute` does `new URL(request.url)` per call and `startsWith(route.path)` for prefix matches. Lines 171-188 short-circuit every OPTIONS request to a 204 response, so an explicitly configured OPTIONS route can never reach its origin.

Tests: `test/gateway-pipeline.test.ts` builds compiled gateways and exercises resolution.

## Files
- `src/gateway/compiler.ts`
- `src/gateway/runtime.ts`
- `test/gateway-pipeline.test.ts`

## Done When
- Config `"method": "get"` matches GET requests.
- Route `/api` no longer matches `/apiary/secret`.
- Reordering the two `/udemy/api` config entries does not change resolution.
- An explicit OPTIONS route reaches its origin; preflight still answers 204.
- Duplicate policy names fail compilation.
- `npm run check` passes.

## Rules
Follow the supplied worker contract. Stay within scope. Maintain this phase's `notes.md` and `journal.md`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
