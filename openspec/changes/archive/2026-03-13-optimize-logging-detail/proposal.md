## Why

The current gateway logs are sparse and inconsistent, which makes it difficult to trace a request through route resolution, policy execution, origin handling, and error paths. We need richer step-level logging now that the request pipeline has been refactored into discrete stages and multiple origins and policies are in active use.

## What Changes

- Add detailed request-lifecycle logging for gateway execution, including route matching, request policy evaluation, origin invocation, response policy execution, analytics scheduling, and terminal error handling.
- Standardize log event shape and context so logs include request identifiers, route metadata, policy/origin names, and outcome details instead of ad hoc `console.log` messages.
- Replace scattered low-context logging in runtime and origin handlers with centralized, predictable logging hooks.
- Preserve existing request routing and response behavior while improving debuggability and operational visibility.

## Capabilities

### New Capabilities
- `gateway-execution-logging`: Defines detailed, step-by-step logging requirements for gateway request execution and failure handling.

### Modified Capabilities

## Impact

- Affected code: `src/index.ts`, `src/gateway/`, `src/origins/`, `src/services/analytics.ts`, and any tests covering request execution.
- Affected systems: Cloudflare Worker runtime logs and operational debugging workflows.
- Dependencies: no new external services are required, but runtime logging output will increase and should remain bounded and consistent.
