## 1. Runtime Logging Model

- [x] 1.1 Add a shared gateway log event shape/helper that can emit structured stage logs with request, route, and outcome context.
- [x] 1.2 Update `src/index.ts` and `src/gateway/runtime.ts` to log route resolution, request policy execution, origin invocation, response policy execution, analytics scheduling, route misses, and unhandled failures through the shared helper.

## 2. Origin And Error Logging

- [x] 2.1 Normalize origin-handler logging in `src/origins/url.ts`, `src/origins/proxyAll.ts`, and `src/origins/upstreamWithFallback.ts` so primary failures, fallback attempts, fallback results, and terminal upstream errors use the same contextual log shape.
- [x] 2.2 Replace remaining low-context runtime/origin console output with actionable error and recovery logs that identify the failing stage and affected origin or route.

## 3. Verification

- [x] 3.1 Extend gateway execution tests to verify log coverage for successful requests, request-policy short-circuits, route misses, unhandled failures, and fallback scenarios.
- [x] 3.2 Run the relevant verification commands and confirm the logging refactor does not change request-routing or response behavior.
