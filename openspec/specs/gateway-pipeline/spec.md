## Purpose

Define how the Cloudflare Worker gateway compiles configured routes and policies into an executable request pipeline, and how terminal responses are produced and finalized.

## Requirements

### Requirement: Gateway compiles configuration into an executable pipeline
The gateway SHALL compile configured routes, origins, and request/response policies into a typed executable model before handling requests. Compilation MUST resolve policy and origin handlers once and MUST fail with a configuration error if a referenced handler cannot be resolved.

#### Scenario: Startup resolves all referenced handlers
- **WHEN** the worker loads a configuration whose routes reference defined origin and policy handlers
- **THEN** the gateway compiles an executable route model before request handling begins

#### Scenario: Startup rejects an unknown handler reference
- **WHEN** the worker loads a configuration that references a request policy, response policy, or origin handler that does not exist
- **THEN** compilation fails instead of deferring the error to request execution

### Requirement: Gateway executes requests through ordered pipeline stages
For a matched route, the gateway SHALL process a request in this order: route resolution, request policies, origin invocation, response policies, and terminal response finalization. Request policies MUST execute in configured order and MAY terminate the pipeline early by returning a `Response`.

#### Scenario: Request policy short-circuits before origin invocation
- **WHEN** a matched route has a request policy that returns a `Response`
- **THEN** the gateway returns that `Response` without invoking the origin handler

#### Scenario: Successful request reaches the origin and response policies
- **WHEN** a matched route's request policies all return a request object
- **THEN** the gateway invokes the origin handler and applies response policies after the origin response is produced

### Requirement: Gateway uses a single terminal response finalizer
The gateway SHALL finalize all terminal outcomes through one shared response-finalization path. Finalization MUST calculate request latency, MUST trigger analytics logging for the resulting response, and MUST return the terminal `Response` for successful origin responses, request-policy short-circuits, route misses, and unhandled failures.

#### Scenario: Route miss returns a finalized not-found response
- **WHEN** no configured route matches an incoming request
- **THEN** the gateway returns a finalized `404` response and logs analytics for that outcome

#### Scenario: Unhandled execution failure returns a finalized error response
- **WHEN** an unexpected error occurs during pipeline execution
- **THEN** the gateway returns a finalized `500` response and logs analytics for that outcome
