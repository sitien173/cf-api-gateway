## Original User Request

Replace the hard-coded `src/config.json` in this Cloudflare Workers API gateway
with a ConfigCat-sourced routing document. This phase adds only the validation
layer that later phases consume.

## Phase

A pure, tested function that reports whether a parsed routing document has a
valid shape.

## Tasks

- task-1: Define a JSON Schema for the gateway routing document, shape only.
- task-2: Export `validateGatewayConfig(value: unknown)` returning a
  discriminated result.
- task-3: Write unit tests for one valid and three malformed documents.

## Context

`src/gateway/types.ts:35` defines `GatewayConfig` as `{ routes:
GatewayRouteConfig[]; policies: GatewayPolicyConfig[] }`. `GatewayRouteConfig`
at `src/gateway/types.ts:22` has `path`, `method`, `origin: { type, options? }`,
and `policies: { request: string[]; response: string[] }`. `GatewayPolicyConfig`
at `src/gateway/types.ts:16` has `name`, `type`, and optional `options`.

`@cfworker/json-schema` is already a dependency, used by
`src/policies/request/json-body-validation.ts`. Match how that file constructs
and runs a validator.

`src/config.json` is the current live routing document and is the positive
fixture for these tests.

Deliberately out of scope for the schema, because
`compileGateway` at `src/gateway/compiler.ts:60` already enforces them and
duplicating the lists would create drift:

- Enumerating valid origin types, policy types, or HTTP methods.
- Resolving a name in `policies.request` against an entry in the `policies`
  array.
- The rule at `src/gateway/compiler.ts:86` that a non-public method must carry
  an `auth0jwt` policy. JSON Schema cannot express this, since it spans two
  sibling arrays. Do not attempt it.

## Files

- `src/config/schema.ts`
- `test/config-schema.test.ts`

## Done When

- The schema requires `routes` and `policies` as arrays; each route requires
  `path`, `method`, `origin.type`, `policies.request`, `policies.response`;
  `path` and `method` are strings; both policy lists are arrays of strings; each
  policy requires `name` and `type` as strings.
- `origin.options` and policy `options` are left unconstrained.
- `validateGatewayConfig` accepts the current contents of `src/config.json`.
- `validateGatewayConfig` rejects, each with a non-empty error list: a document
  missing `routes`; a document where `policies.request` is not an array; a route
  missing `origin.type`.
- The result is a discriminated union. The function does not throw on invalid
  input.
- No enums for origin types, policy types, or HTTP methods appear in the schema.
- `src/config.json`, `src/index.ts`, and every existing test are unchanged.
- `npm run typecheck`
- `npm test`

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's
`notes.md` and `journal.md`.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
