## Original User Request

Replace the bundled `src/config.json` with a routing document sourced from
ConfigCat, validated and cached, with Workers KV as backing storage.

## Phase

Phase 2: a tested storage and client adapter layer that Phase 3's resolver
consumes. No resolution behavior of its own.

## Tasks

- task-1: Add `@configcat/sdk` as a runtime dependency, updating both
  `package.json` and `package-lock.json`.
- task-2: Implement gateway-scoped key derivation for both prefixes,
  `cc:<gatewayName>:<sdkCacheKey>` and `lkg:<gatewayName>:gateway_config`,
  reading `gatewayName` from `GATEWAY_NAME`. Derivation must fail explicitly
  when `GATEWAY_NAME` is unset or empty, never falling back to an unscoped key.
- task-3: Implement the KV backed `IConfigCatCache` with `get` and `set`,
  passing `{ cacheTtl: 60 }` on reads.
- task-4: Implement `readLkg` and `writeLkg` over an envelope carrying the raw
  document string and its ConfigCat config timestamp. `writeLkg` is a no-op when
  the stored envelope's timestamp is greater than or equal to the incoming one.

## Context

Verified facts, do not re-derive them:

- `@configcat/sdk` latest is `1.1.0`. Install with
  `npm install @configcat/sdk@^1.1.0 --save`.
- `tsconfig.json` sets `moduleResolution: "node"`, which ignores the package
  `exports` map. A subpath import such as `@configcat/sdk/cloudflare-worker`
  will not typecheck. Import `IConfigCatCache` as a type-only import from the
  package root `@configcat/sdk`, which resolves through the package `types`
  field and does re-export it. Runtime entry selection for workerd is a Phase 4
  bundling concern, not this phase's.
- The interface, verified from the published typings:
  ```ts
  interface IConfigCatCache {
    set(key: string, value: string): Promise<void> | void;
    get(key: string): Promise<string | null | undefined> | string | null | undefined;
  }
  ```
- `KVNamespace` comes from the generated `worker-configuration.d.ts` at the repo
  root. It is already in scope; do not add `@cloudflare/workers-types`.
- Phase 3 will source the envelope timestamp from
  `getValueDetailsAsync(...).fetchTime`, which is `Date | undefined`. The
  envelope timestamp field is therefore epoch milliseconds as a `number`.
- `tsconfig.json` excludes `test/`, so `npm run typecheck` does not cover test
  files. `npm test` runs them through `tsx --test`.
- Test style: `node:test` plus `node:assert/strict`. See
  `test/config-schema.test.ts` for the house pattern.
- `src/config/schema.ts` already exists from Phase 1. This phase does not call
  it.

Shape guidance, to keep Phase 3 compatible:

- `src/index.ts`'s `Env` interface does not yet carry the KV binding; Phase 4
  adds it. Declare a narrow local type in `src/config/kv.ts` instead, along the
  lines of `{ GATEWAY_NAME?: string; GATEWAY_CONFIG: KVNamespace }`. Do not
  modify `src/index.ts`.
- The envelope must be versioned and must tolerate a legacy bare-string value,
  because Phase 4 ships before any envelope exists in KV. Treat an unparseable
  or non-envelope stored value as a raw document with timestamp `0`.
- A KV read or write rejection must be caught inside the module and logged at
  error level, never left as an unhandled rejection. `writeLkg` reports whether
  it wrote.

## Files

- Create: `src/config/kv.ts`
- Create: `test/config-kv.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

Nothing else. `src/index.ts`, `src/config.json`, `src/config/schema.ts`, and
`wrangler.toml` stay unchanged.

## Done When

- Key derivation fails explicitly when `GATEWAY_NAME` is unset, verified by test.
- Two different gateway names produce disjoint keys for both prefixes, verified
  by test.
- The `cc:` prefix is applied to the key the SDK supplies rather than replacing
  it, so the SDK's own cache-key semantics survive.
- `writeLkg` does not overwrite a stored envelope whose timestamp is greater
  than or equal to the incoming one, verified by test.
- A rejected KV write surfaces as a caught error, verified by test with a fake
  KV whose `put` rejects.
- `readLkg` handles a missing key, a legacy bare-string value, and a corrupt
  JSON value without throwing, verified by test.
- No resolution, schema validation, or `compileGateway` logic appears in this
  phase.
- `npm run typecheck`
- `npm test`

Fake KV in tests is a `Map`-backed object exposing `get` and `put`, matching the
dependency-injection style the existing tests already use.

## Rules

Follow the supplied worker contract. Stay within scope. Maintain this phase's
`notes.md` and `journal.md`.

## Response Format

Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
