## User Request
Replace the route `path` matching rules with nginx `location` semantics: `= /p` exact, `^~ /p` prefix that stops regex search, `~ re` regex, `~* re` case-insensitive regex, bare `/p` prefix. Breaking change: bare path is a prefix, trailing `/*` is rejected, the `proxyAll` implicit prefix rule is removed. Migrate `src/config.json`, update tests and README.

## Phase
The gateway compiles and resolves routes by nginx location rules, and `src/config.json` uses the new syntax.

## Tasks
- task-1: Schema and types. Route `path` pattern in `src/config/schema.ts` becomes `^(?:(?:= |\^~ )?/(?!.*/\*$)\S*|~\*? \S+)$`. In `src/gateway/types.ts`: `RouteMatchMode = "exact" | "prefix" | "prefixStop" | "regex"`; `CompiledRoute` adds `pattern: string`, `regex?: RegExp`, `order: number`. In `src/index.ts` the synthetic unavailable-configuration route sets `pattern` to the pathname and `order: 0`.
- task-2: Compiler. In `src/gateway/compiler.ts` add `parseRoutePath(path)` returning `{ matchMode, pattern, regex? }` per the DESIGN table. `~*` uses flag `i`; no implicit anchors; never `g` or `y`. A `RegExp` constructor error throws with the existing `Route <METHOD> <path>: ` label. Duplicate keys per method: `exact:<pattern>`, `prefix:<pattern>` shared by bare and `^~`, `regex:<path>`. `compareRoutes`: exact first, then `prefix`/`prefixStop` by descending pattern length, then `regex` by ascending `order` (route index in `config.routes`). Remove `hasWildcardSuffix`, `resolveMatchMode`, `normalizeRoutePath`, and the `proxyAll` prefix rule. `CompiledRoute.path` keeps the raw configured string.
- task-3: Runtime and config. Replace `resolveRoute` in `src/gateway/runtime.ts` with one pass over sorted routes filtered by method: `exact` returns on `pathname === pattern`; the first `prefix`/`prefixStop` `startsWith` hit is the longest, return it if `prefixStop`, otherwise remember it; `regex` returns on first `regex.test(pathname)`; finally return the remembered prefix or `undefined`. Remove `matchesPrefix`. Rewrite `src/config.json` routes: `/udemy/v3` -> `= /udemy/v3`; both `/udemy/v3/api/*` routes -> `/udemy/v3/api/`; the two sonarqube routes -> one route `"~ ^/sonarqube(/|$)"` and the two vault routes -> one route `"~ ^/vault(/|$)"`, each with methods GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH and the same origin, auth, and policies as the current `/x/*` route. Keep the vault `description`.
- task-4: Tests and docs. Add the cases below to `test/compiler.test.ts`, `test/gateway-pipeline.test.ts`, `test/config-schema.test.ts`. Migrate fixtures in any other test file whose paths use `/*` or rely on bare-path exact matching or the `proxyAll` prefix rule; do not weaken unrelated assertions. Update `README.md` lines 120 to 140 for the five forms, selection order, duplicate rules, removal of `/*` and the `proxyAll` prefix rule, matching on raw `URL.pathname`, and a note that regexes are trusted and unguarded.

## Context
- Design: `/home/ngosi/projects/cf-api-gateway/docs/plans/nginx-location-matching/DESIGN.md`. Read it fully first.
- Plan: `/home/ngosi/projects/cf-api-gateway/docs/plans/nginx-location-matching/PLAN.md`.
- Project rules: `/home/ngosi/projects/cf-api-gateway/AGENTS.md`. Tests use `node:test` and `node:assert/strict`, import sources with `.ts`.
- `src/gateway/runtime.ts` `resolvePreflightRoute` calls `resolveRoute` with the requested method; keep that.
- Logs and analytics read `route.path`; it must remain the raw configured string.
- Schema validation uses `@cfworker/json-schema`; the `/x/*` rejection test proves its lookahead support.
- `test/config-schema.test.ts` uses `src/config.json` as its fixture and indexes origins by name.

## Files
- `src/config/schema.ts`
- `src/gateway/types.ts`
- `src/gateway/compiler.ts`
- `src/gateway/runtime.ts`
- `src/index.ts`
- `src/config.json`
- `test/compiler.test.ts`
- `test/gateway-pipeline.test.ts`
- `test/config-schema.test.ts`
- Other `test/*.test.ts` files: fixture path migration only
- `README.md`

Out of scope: `src/origins/`, `src/policies/`, `wrangler.toml`, `worker-configuration.d.ts`, `.dev.vars`, any secret-bearing file.

## Done When
- `= /a` matches only `/a`; bare `/a` matches `/a`, `/a/b`, and `/ax`.
- With GET routes `= /a`, `^~ /a/`, `~ ^/a/b`, `/a/b/c`: `/a` -> `= /a`; `/a/b` -> `^~ /a/`; `/a/b/c/d` -> `~ ^/a/b`.
- With GET routes `/a/` and `~ ^/z`: `/a/q` -> `/a/`.
- An earlier regex wins over a later regex and over a longer plain prefix.
- `~* \.PNG$` matches `/x.png`.
- Invalid regex, `@x`, `/x/*`, `=/x`, `~` with no pattern, and `/x/` plus `^~ /x/` on one method each reject the document. `= /x` with `/x` on one method is accepted.
- A `proxyAll` origin with path `/x` is a plain prefix route, not special-cased.
- Preflight resolves by `Access-Control-Request-Method` under the new rules.
- Analytics and log `routePath` equal the configured string.
- `src/config.json` validates and compiles; `GET /vault`, `POST /vault/api/x`, `GET /sonarqube`, `GET /udemy/v3/api/x` resolve to the intended routes; `GET /vaultx` does not resolve to the vault route.
- The `apiKeyOrAuth0` write-method rule and its tests are unchanged.
- `npm run lint`
- `npm run check`
- `npm run types:check`
- `npm run bundle`

## Rules
Follow these bundled files:
- Contract: /home/ngosi/projects/refract/plugin/shared/worker-contract.md
- Response: /home/ngosi/projects/refract/plugin/shared/erp.md
- Notes: /home/ngosi/projects/refract/plugin/shared/notes-template.md
- Journal: /home/ngosi/projects/refract/plugin/shared/journal-template.md

- Write notes to `/home/ngosi/projects/cf-api-gateway/docs/plans/nginx-location-matching/phase-01/notes.md` and append your ERP to `phase-01/journal.md` under `## Implementation Response`.
- Do not run any git command that changes state: no commit, stash, reset, checkout, or clean.
- Use test-first order: write the failing test, see it fail, then implement.
- Match surrounding code style. No new dependencies. No changes beyond the listed files.
- New log output, if any, goes through `emitGatewayLog`.

## Response Format
Return the ERP `# EXTERNAL RESPONSE` block and matching status line.
