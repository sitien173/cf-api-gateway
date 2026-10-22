# nginx Location Matching Design

**Status:** Confirmed 2026-10-22
**Consultation:** consult job `ec5efd67-0207-4586-b476-265ad74469c2` ran without tool access; tier ordering, regex flags, and duplicate keys adopted; origin hardening rejected after code check because `src/origins/url.ts:11-19` already adds a leading `/` and `stripPrefix` only rewrites `Location` headers in `src/origins/failover.ts:149-180`.

## Purpose

Replace the route `path` matching rules with nginx `location` semantics so one route can express exact, prefix, prefix-that-stops-regex, and regex matches. A bare path and its subtree can then be served by one route.

## Users and Success Criteria

Users: authors of the gateway configuration document in `src/config.json` and the ConfigCat setting `gateway_config`.

Success criteria:

- `path` accepts `= <path>`, `^~ <path>`, `~ <regex>`, `~* <regex>`, and a bare `<path>`.
- Route selection follows the nginx algorithm described under Architecture.
- `src/config.json` uses the new syntax, with vault and sonarqube each reduced to one regex route.
- `npm run lint`, `npm run check`, `npm run types:check`, and `npm run bundle` pass.

## Constraints and Non-Goals

Constraints:

- Breaking change. A bare path is a prefix match. The trailing `/*` form and the `proxyAll` implicit prefix rule are removed. The schema rejects `/*`, so stale documents fail validation.
- Compilation stays all-or-nothing. An invalid regex rejects the document.
- The `apiKeyOrAuth0` write-method rule in `src/gateway/compiler.ts` is unchanged.

Non-goals:

- The nginx `@` named location. It only serves internal redirects, which the gateway does not have.
- Regex captures for origins. Origins keep rewriting through `pathRewrite` and `stripPrefix`.
- Percent-decoding or slash-collapsing the request path. Matching uses the raw `URL.pathname`, as it does today.
- A ReDoS guard. Documents come from trusted authors.
- Origin handler changes.

## Chosen Approach

Tiered single pass. The compiler parses each path into a match mode and sorts compiled routes as exact, then prefixes by descending pattern length, then regexes in document order. `resolveRoute` walks that list once.

Rejected: per-method buckets of `Map` plus arrays. Faster exact lookup, but changes the `CompiledGateway` shape, the synthetic gateway in `src/index.ts`, and every test that reads `gateway.routes`.

## Architecture and Data Flow

Schema, `src/config/schema.ts`: route `path` uses the pattern

```
^(?:(?:= |\^~ )?/(?!.*/\*$)\S*|~\*? \S+)$
```

It rejects `@name`, unknown modifiers, more than one space, a non-regex path without a leading `/`, and a non-regex path ending in `/*`.

Types, `src/gateway/types.ts`:

- `RouteMatchMode = "exact" | "prefix" | "prefixStop" | "regex"`.
- `CompiledRoute` adds `pattern: string`, `regex?: RegExp`, and `order: number`. `path` keeps the raw configured string, so logs and analytics `blob1` record values such as `= /udemy/v3`.

Compiler, `src/gateway/compiler.ts`:

- `parseRoutePath(path)` returns `{ matchMode, pattern, regex? }`.

  | Path | matchMode | Matching |
  |---|---|---|
  | `= /p` | `exact` | `pathname === "/p"` |
  | `^~ /p` | `prefixStop` | `pathname.startsWith("/p")`; stops regex search |
  | `~ re` | `regex` | `new RegExp(re)` |
  | `~* re` | `regex` | `new RegExp(re, "i")` |
  | `/p` | `prefix` | `pathname.startsWith("/p")` |

- Regexes are not anchored implicitly. A `RegExp` constructor error throws `Route <METHOD> <path>: invalid regex ...`.
- Duplicate key per method: `exact:<pattern>` for `=`; `prefix:<pattern>` shared by bare and `^~`; `regex:<path>` for `~` and `~*`. So `= /x` and `/x` coexist, while `/x/` and `^~ /x/` on one method are duplicates.
- `compareRoutes` orders exact, then `prefix` and `prefixStop` by descending pattern length, then `regex` by ascending `order`, which is the route index in the document.
- `resolveMatchMode`, `hasWildcardSuffix`, `normalizeRoutePath`, and the `proxyAll` prefix rule are removed.

Runtime, `src/gateway/runtime.ts`: `resolveRoute` filters by method and walks the sorted routes once.

1. `exact`: return on `pathname === pattern`.
2. `prefix` or `prefixStop`: the first `startsWith` hit is the longest. Return it if `prefixStop`, otherwise remember it.
3. `regex`: return on the first `regex.test(pathname)`.
4. Return the remembered prefix, or `undefined` for `404`.

`matchesPrefix` is removed. Preflight resolution is unchanged and resolves by the requested method.

`src/index.ts:42`: the synthetic unavailable-configuration route adds `pattern` set to the pathname and `order: 0`.

## Errors and Edge Cases

- Invalid regex, malformed path, or duplicate key rejects the document. The active gateway stays in place.
- A bare prefix such as `/vault` matches `/vaultx`, as in nginx.
- `~*` is case-insensitive. All other modes are case-sensitive.
- No `g` or `y` flag is ever set, so `RegExp.test` stays stateless across requests in the per-isolate compiled gateway.

## Migration

`src/config.json` routes:

| Current | New | Methods | Behaviour |
|---|---|---|---|
| `/udemy/v3` | `= /udemy/v3` | GET | same |
| `/udemy/v3/api/*` | `/udemy/v3/api/` | GET | same |
| `/udemy/v3/api/*` | `/udemy/v3/api/` | POST, PUT, DELETE | same |
| `/sonarqube` and `/sonarqube/*` | `~ ^/sonarqube(/\|$)` | GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH | bare `/sonarqube` now accepts all seven methods |
| `/vault` and `/vault/*` | `~ ^/vault(/\|$)` | GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH | bare `/vault` now accepts all seven methods |

In JSON the regex is written `"~ ^/vault(/|$)"`.

Deploy order:

1. Deploy the code. The old ConfigCat document and last-known-good copy fail the new schema; isolates fall back to the bundled `src/config.json`.
2. The user rewrites the ConfigCat `gateway_config` document to the new syntax.
3. Rollback: old code rejects the new document and falls back to its own bundled file.

Step 2 belongs to the user, not to a code phase.

## Testing

- `test/compiler.test.ts`: parsing of every mode; invalid regex rejection; duplicate rules; sort order; `proxyAll` no longer forces a prefix.
- `test/gateway-pipeline.test.ts`: `=` beats all; longest `^~` beats a regex; first regex in document order beats a longer plain prefix; longest plain prefix wins with no regex hit; `/vault` prefix matches `/vaultx`; `~*` ignores case; preflight resolves by the requested method.
- `test/config-schema.test.ts`: schema rejects `@x`, `/x/*`, `=/x`, and `~` with no pattern; migrated `src/config.json` validates and compiles.
- `README.md` routing section updated in the same change.

One phase. Schema, compiler, runtime, `src/config.json`, and `test/config-schema.test.ts` are coupled through the fixture, so a split leaves a failing phase.

## Risks and Open Questions

- Between deploy and the ConfigCat rewrite, every isolate serves the bundled document. Any ConfigCat-only change is absent in that window.
- Analytics `blob1` and log `routePath` values change format. Existing queries filtering on `/vault/*` stop matching.
- A backtracking regex in a document can consume Worker CPU. Accepted; authors are trusted.
- `@cfworker/json-schema` must evaluate the lookahead in the schema pattern. Phase 1 verifies it with a test.
