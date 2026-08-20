# Phase 1 — Decision Notes

## Task 1

### Decisions made
- Added `tsx` at `^4.23.12` and upgraded Wrangler to `^4.124.0` so the development toolchain is reproducible and the high-severity audit findings are resolved.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Wrangler-generated worker types are maintained alongside the dependency upgrade so `wrangler types --check` remains a meaningful gate.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `npm audit --audit-level=high` initially reported 6 vulnerabilities (5 high); after the dependency update and `npm ci`, it reports 0 vulnerabilities.

## Task 2

### Decisions made
- `test` uses `tsx --test` over all `test/**/*.test.ts` files; `check` combines source type-checking and the test suite.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- The committed test layout remains under `test/` with `.test.ts` filenames.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `npm test` first failed with `Missing script: "test"`; after adding the scripts, `npm test` passed all 14 tests and `npm run check` passed type-checking plus all 14 tests.

## Task 3

### Decisions made
- CI uses the current official major action tags `actions/checkout@v6` and `actions/setup-node@v7`, installs with `npm ci`, and runs check, Wrangler type validation, audit, and dry-run bundling.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- GitHub-hosted `ubuntu-latest` runners provide Node.js 24 through setup-node.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `npm run types:check` initially detected stale Wrangler-generated types after the upgrade; regenerating and normalizing the tracked declaration file made it pass. Direct review corrected stale action majors against current GitHub documentation. `npm run check`, `npm audit --audit-level=high`, and `npm run bundle` all pass.

## Task 4

### Decisions made
- Added `dist/` to `.gitignore`, removed the tracked bundle files from the index, and documented `npm run bundle` as the ignored dry-run artifact generator.

### Spec deviations
- none

### Tradeoffs accepted
- none

### Assumptions
- Deployment continues to use `src/index.ts` from `wrangler.toml`; generated `dist/` output is only a CI/release artifact.

### Follow-ups for human
- none

### Test evidence
- RED -> GREEN: `git ls-files dist` is empty after removing the tracked artifacts; `git diff --check` passes.
