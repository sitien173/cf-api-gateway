# nginx Location Matching Plan

**Design:** `docs/plans/nginx-location-matching/DESIGN.md`
**Base:** `refs/plans/nginx-location-matching/base` at `d519f6cc230eaf8302c560c473dad2f066313cb6`. All four gates pass at base.

**Commit:** `feat(gateway)!: nginx location modifiers and regex for route paths`

### Phase 1: Route paths use nginx location matching

**Task Guide Input:** Non-repository-UI server change in a Cloudflare Worker gateway: replace route `path` matching with nginx `location` semantics (`=`, `^~`, `~`, `~*`, bare prefix), migrate `src/config.json`, update tests and README. Use cases: repository implementation, then independent code-quality review.
**Goal:** The gateway compiles and resolves routes by nginx location rules as specified in `DESIGN.md`, and `src/config.json` uses the new syntax.
**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/gateway/compiler.ts`
- Modify: `src/gateway/runtime.ts`
- Modify: `src/index.ts`
- Modify: `src/config.json`
- Modify: `test/compiler.test.ts`
- Modify: `test/gateway-pipeline.test.ts`
- Modify: `test/config-schema.test.ts`
- Modify: `README.md`

**Tasks:**
1. Schema and types. Set the route `path` pattern in `src/config/schema.ts` to `^(?:(?:= |\^~ )?/(?!.*/\*$)\S*|~\*? \S+)$`. In `src/gateway/types.ts` set `RouteMatchMode = "exact" | "prefix" | "prefixStop" | "regex"` and add `pattern: string`, `regex?: RegExp`, `order: number` to `CompiledRoute`. In `src/index.ts` the synthetic route sets `pattern` to the pathname and `order: 0`.
2. Compiler. Add `parseRoutePath` per the DESIGN table; `~*` uses flag `i`, no implicit anchors, no `g` or `y`. Invalid regex throws with the `Route <METHOD> <path>: ` label. Duplicate keys per method: `exact:<pattern>`, `prefix:<pattern>` shared by bare and `^~`, `regex:<path>`. Sort exact, then prefixes by descending pattern length, then regexes by document order. Remove `hasWildcardSuffix`, `resolveMatchMode`, `normalizeRoutePath`, and the `proxyAll` prefix rule. `path` keeps the raw configured string.
3. Runtime and config. Replace `resolveRoute` in `src/gateway/runtime.ts` with the single pass in DESIGN and remove `matchesPrefix`. Rewrite `src/config.json` routes per the DESIGN Migration table, merging vault and sonarqube into `"~ ^/vault(/|$)"` and `"~ ^/sonarqube(/|$)"` with all seven methods.
4. Tests and docs. Add the cases listed under DESIGN Testing to the three test files, including a schema test that `/x/*` is rejected, which proves `@cfworker/json-schema` evaluates the lookahead. Update `README.md` lines 120 to 140 for the five forms, the selection order, duplicate rules, removal of `/*` and the `proxyAll` prefix rule, raw-pathname matching, and the trusted-regex note.

**Acceptance Criteria:**
- `= /a` matches only `/a`; bare `/a` matches `/a`, `/a/b`, and `/ax`.
- With GET routes `= /a`, `^~ /a/`, `~ ^/a/b`, and `/a/b/c`: `/a` resolves to `= /a`; `/a/b` resolves to `^~ /a/`, the longest prefix, which stops regex search; `/a/b/c/d` resolves to `~ ^/a/b`, because the longest prefix `/a/b/c` is plain and the regex matches.
- With GET routes `/a/` and `~ ^/z`: `/a/q` resolves to `/a/`, because no regex matches.
- A regex earlier in the document wins over a later regex and over a longer plain prefix.
- `~* \.PNG$` matches `/x.png`.
- Invalid regex, `@x`, `/x/*`, `=/x`, and `/x/` plus `^~ /x/` on one method each reject the document.
- Analytics `routePath` and log `routePath` equal the configured string, for example `~ ^/vault(/|$)`.
- `src/config.json` validates and compiles; `GET /vault`, `POST /vault/api/x`, `GET /sonarqube`, and `GET /udemy/v3/api/x` resolve to the intended routes.
- The `apiKeyOrAuth0` write-method rule and its tests are unchanged.

**Reviewer Checklist:**
- Selection matches nginx order: exact, longest prefix, `^~` stop, regex in document order, fallback prefix.
- No `RegExp` carries `g` or `y`; regexes are built once at compile time, never per request.
- Duplicate detection treats bare and `^~` of the same pattern as one key.
- Preflight still resolves by `Access-Control-Request-Method`.
- No change to `src/origins/`, policies, `wrangler.toml`, or `worker-configuration.d.ts`.
- `test/config-schema.test.ts` still indexes origins by name and passes against the new `src/config.json`.
- README matches the code.

**Verification Checks:**
- `npm run lint`
- `npm run check`
- `npm run types:check`
- `npm run bundle`

## Post-merge

The user rewrites the ConfigCat `gateway_config` document to the new syntax after deploy. Until then isolates serve the bundled `src/config.json`.
