# Route Config v2 Design

**Status:** Confirmed 2026-10-21
**Consultation:** consult job 8d167839 recommended named origins plus a `methods` array, with runtime unchanged; its example option names were corrected against source.

## Purpose

Make the gateway route config easy to author and review. Remove per-method route duplication, repeated origin blocks, and the untyped `comment` field. Replace the loose JSON Schema with a strict one that validates per-type options.

## Users and Success Criteria

Users: maintainers who edit `src/config.json` and the ConfigCat flag `gateway_config`.

Success criteria:

- The current 16 routes are expressed as 10 routes with no repeated origin blocks.
- Unknown keys, invalid methods, and invalid per-type options fail schema validation with a targeted error.
- Unresolved origin or policy names, wrong-phase policies, and duplicate `(path, method)` pairs fail compilation with an error naming the route.
- Runtime request behavior is unchanged: existing test assertions pass after fixtures move to v2.
- `npm run check` passes and `npm run bundle` succeeds.

## Constraints and Non-Goals

Constraints:

- Hard cutover: runtime accepts only the v2 shape. No v1 compatibility layer.
- `CompiledRoute`, `src/gateway/runtime.ts`, origins, and policy handlers stay unchanged.
- The fallback chain in `src/config/source.ts` stays unchanged.

Non-goals:

- Route groups, inheritance, or defaults.
- Inline origin or policy definitions on routes.
- A v1 to v2 converter script.
- New origin or policy types.

## Chosen Approach

Named maps plus a `methods` array. Top-level `origins` and `policies` maps are keyed by name. Each route lists `methods` and references one origin and its policies by name.

Rejected:

- Route groups with defaults: least repetition, but needs merge and override rules.
- `methods` array only: origin blocks still repeat on every route.

## Architecture and Data Flow

### Config shape

```json
{
  "origins": {
    "udemy-writer": {
      "type": "url",
      "options": { "url": "https://...", "pathRewrite": "/udemy" }
    }
  },
  "policies": {
    "udemy-cors": { "type": "cors", "options": { "...": "..." } },
    "require-auth0": { "type": "apiKeyOrAuth0" }
  },
  "routes": [
    {
      "description": "Udemy writes",
      "path": "/udemy/api/*",
      "methods": ["POST", "PUT", "DELETE"],
      "origin": "udemy-writer",
      "request": ["require-auth0"],
      "response": ["udemy-cors", "hcmc-cors"]
    }
  ]
}
```

- Root: `origins`, `policies`, `routes` required; no other keys.
- Map keys for `origins` and `policies` match `^[a-z0-9][a-z0-9-]*$`.
- Origin: `{ type, options, description? }`.
- Policy: `{ type, options?, description? }`.
- Route: `{ path, methods, origin, request?, response?, description? }`.
  - `path`: string starting with `/`, optional `/*` suffix.
  - `methods`: non-empty, unique, from `GET HEAD POST PUT PATCH DELETE OPTIONS`.
  - `origin`: an `origins` key.
  - `request`, `response`: arrays of `policies` keys; default `[]`.
  - `description` replaces `comment`.

### Per-type options

| Kind | `type` | Required options | Optional options |
|---|---|---|---|
| origin | `url` | `url` | `pathRewrite`, `timeout` |
| origin | `proxyAll` | `primaryUrl`, `fallbackUrl` | `stripPrefix`, `healthCheckPath`, `healthCheckTimeout`, `healthCheckCacheTtl` |
| origin | `upstreamWithFallback` | `primaryUrl`, `fallbackUrl` | `stripPrefix`, `healthCheckPath`, `healthCheckTimeout`, `healthCheckCacheTtl` |
| policy | `cors` | `allowedOrigins`, `allowedMethods`, `allowedHeaders`, `allowCredentials` | `exposedHeaders`, `maxAge` |
| policy | `apiKeyOrAuth0` | none | none |
| policy | `basicAuth` | `username`, `password` | none |
| policy | `changeMethod` | `method` | none |
| policy | `jsonBodyValidation` | `schema` | none |
| policy | `addHeaders` | `headers` | none |

`type` values equal the handler export names in `src/origins/index.ts`, `src/policies/request/index.ts`, and `src/policies/response/index.ts`.

### Schema technique

- `additionalProperties: false` on every object, including each options object.
- `type` is a closed enum. Options are constrained by `allOf` of `if: { type: const X } then: { options: <schema> }`, not `oneOf`, so a failure reports errors for the matched type only.

### Compiler

- New input types in `src/gateway/types.ts`: `OriginConfig`, `PolicyConfig`, `RouteConfig`, `GatewayConfig`.
- `compileGateway` expands each route into one `CompiledRoute` per method, resolves origin and policies by name, and emits the same `CompiledRoute[]` with the same sort order.
- Compiler-only rules, since JSON Schema cannot express cross-references:
  - origin and policy names resolve;
  - a policy's handler exists in the phase it is listed under;
  - non `GET`/`HEAD`/`OPTIONS` methods require an `apiKeyOrAuth0` policy;
  - CORS `*` origin cannot combine with credentials;
  - no duplicate `(path, method)` pair (new).
- Duplicate-name detection is removed; map keys are unique.

## Errors and Edge Cases

- Schema failure returns `OutputUnit[]` as today.
- Compile errors are prefixed with the route, for example `Route POST /udemy/api/*: origin "udemy-writr" not found`.
- A v1 document fails schema validation; `source.ts` falls through to the next candidate.
- `CONNECT` and `TRACE`, accepted by the compiler today, are no longer accepted.

## Migration

1. Rewrite `src/config.json` to v2 with identical routing behavior.
2. Deploy the worker. ConfigCat v1 and KV LKG v1 fail validation; the bundled v2 config serves traffic.
3. Publish v2 JSON to ConfigCat flag `gateway_config`. The first valid fetch overwrites the KV LKG.

Do not publish v2 to ConfigCat before step 2: old workers reject it and stay on the stale LKG. Between steps 2 and 3 each config load makes two failed attempts before the bundled fallback; this adds latency only.

Update README config examples and remove the "Add routes for each HTTP method" note. Check `docs/diagrams/configured-routes.mmd`; update it only if it shows config shape.

## Testing

- `test/config-schema.test.ts`: accepts bundled v2; rejects unknown keys at each level, bad method, empty and duplicate `methods`, bad per-type options, and a v1 document.
- Compiler tests: method expansion, unknown origin or policy name, wrong-phase policy, duplicate `(path, method)`, auth rule per expanded method.
- Existing fixtures in `test/origin-failover.test.ts`, `test/config-source.test.ts`, `test/gateway-pipeline.test.ts`, `test/analytics.test.ts`, `test/auth0-jwt.test.ts`, `test/response-cors.test.ts`, and `test/request-policies.test.ts` move to v2 with assertions unchanged.
- Done when `npm run check` and `npm run bundle` pass.

## Risks and Open Questions

- Deploy-order risk is covered in Migration; publishing to ConfigCat early leaves workers on stale LKG.
- Test fixture rewrite is broad; an accidental assertion change could hide a behavior change. Reviewers must diff assertions separately from fixtures.
- Open: none.
