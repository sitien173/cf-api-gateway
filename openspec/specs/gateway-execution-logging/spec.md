## Purpose

Define the logging requirements for gateway request execution so operational logs consistently describe request stage progression, terminal outcomes, and origin failure or fallback behavior.

## Requirements

### Requirement: Gateway emits contextual logs for each execution stage
The gateway SHALL emit contextual log events for each terminal request path and for each major pipeline stage: route resolution, request policy evaluation, origin invocation, response policy execution, analytics scheduling, and unhandled failure handling. Each log event MUST include enough context to correlate events for a single request, including request method, request path, matched route metadata when available, the current stage name, and the outcome of that stage.

#### Scenario: Matched request produces ordered stage logs
- **WHEN** an incoming request matches a configured route and completes successfully
- **THEN** the gateway emits log events that identify the matched route and record the request-policy, origin, response-policy, and finalization stages for that request

#### Scenario: Request policy short-circuit is logged as a terminal stage
- **WHEN** a request policy returns a `Response` before origin invocation
- **THEN** the gateway emits a log event showing which request policy terminated execution and the status code returned to the client

### Requirement: Gateway logs errors and fallback outcomes with actionable detail
The gateway SHALL log unhandled execution failures and origin-level fallback decisions with actionable detail instead of raw low-context console output. Error and fallback logs MUST identify the stage that failed, the route or origin involved when known, and whether the gateway returned an error response, retried on a fallback path, or continued successfully after recovery.

#### Scenario: Route miss produces a structured terminal log
- **WHEN** no configured route matches an incoming request
- **THEN** the gateway emits a terminal log event that records the route-miss outcome and the resulting `404` response

#### Scenario: Origin failure and fallback are logged distinctly
- **WHEN** an origin handler detects a primary failure and attempts a fallback request
- **THEN** the gateway emits one log event for the primary failure and a separate log event indicating the fallback attempt and its outcome

#### Scenario: Unhandled execution failure produces an actionable error log
- **WHEN** an unexpected error occurs during request execution
- **THEN** the gateway emits an error log event that identifies the failing stage and the resulting `500` response without relying on a raw object dump as the only error output
