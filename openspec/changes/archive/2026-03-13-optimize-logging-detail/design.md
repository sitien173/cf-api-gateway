## Context

The gateway currently logs only a few entrypoint, runtime, and origin events, and those logs do not share a stable shape or enough context to reconstruct a single request path. The recent gateway-pipeline refactor concentrated request execution into `src/gateway/runtime.ts`, which gives us a single place to add consistent stage logging, but origin implementations such as `proxyAll`, `upstreamWithFallback`, and `url` still emit bespoke log lines. The design needs to improve debuggability without changing routing behavior, response contents, or analytics semantics.

## Goals / Non-Goals

**Goals:**
- Introduce a consistent gateway log event model for request lifecycle stages and terminal outcomes.
- Centralize most request-level logging in the compiled pipeline runtime so each request has correlated stage logs.
- Normalize origin and fallback logging to include route/origin context and recovery outcomes.
- Keep the implementation lightweight and compatible with Cloudflare Worker console logging.

**Non-Goals:**
- Introduce an external logging service, tracing backend, or durable log storage.
- Change route matching, policy behavior, origin retry rules, or analytics payloads.
- Add high-volume body logging or sensitive header dumps.

## Decisions

1. **Use structured console logging with a shared helper shape.**
   The gateway will continue to use console output because Cloudflare Workers already collect it, but log calls will emit structured objects with stable keys instead of free-form strings. This keeps rollout simple and avoids adding a dependency or changing deployment configuration.

2. **Log request lifecycle stages from `src/gateway/runtime.ts`.**
   The runtime already owns route resolution, policy iteration, origin invocation, finalization, and error handling. Adding stage logging there yields predictable coverage for normal, short-circuit, route-miss, and failure paths. The alternative, leaving stage logs distributed across handlers, would preserve the current inconsistency and duplicate context-building logic.

3. **Pass route and request context into origin/fallback logging points.**
   Origin modules need enough context to distinguish primary failures, fallback attempts, and terminal upstream errors. Rather than letting each origin invent its own message shape, the design should thread a shared logging helper or contextual metadata into those modules so fallback decisions produce logs that align with pipeline events.

4. **Bound log detail to operationally useful metadata.**
   Logs should include request method, path, route path, stage, policy/origin identifier, status codes, latency when known, and summarized error information. Full request or response bodies remain out of scope to avoid noise and accidental leakage.

## Risks / Trade-offs

- **[Higher log volume]** → Mitigation: limit logs to stage transitions and terminal outcomes, not per-field dumps or payload bodies.
- **[Context drift between runtime and origins]** → Mitigation: use a shared log helper or canonical field set so all modules emit the same shape.
- **[Tests become brittle if they assert full log payloads]** → Mitigation: assert key fields and stage coverage rather than every field ordering detail.
- **[Older ad hoc logs may remain in untouched modules]** → Mitigation: include explicit tasks to replace or normalize existing origin and runtime log statements.

## Migration Plan

1. Add the shared logging model and helper in the gateway runtime layer.
2. Replace runtime and entrypoint ad hoc logs with structured stage logs.
3. Update origin handlers with contextual logs for failures and fallback decisions.
4. Add or extend tests to verify stage coverage for successful, short-circuit, route-miss, and failure scenarios.
5. Deploy normally; rollback is low risk because the change is observability-only and can be reverted by removing the new log helper and restored old log calls if needed.

## Open Questions

- Should request correlation use a generated request identifier, Cloudflare request headers when present, or a best-effort synthetic key from method and URL?
- Should analytics scheduling be logged before or after `waitUntil` is invoked, or both?
- Do legacy origin implementations outside the compiled pipeline need the same structured helper immediately, or can the first pass focus on the active runtime path?
