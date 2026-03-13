## Why

The gateway's runtime flow is concentrated in `src/index.ts`, where config compilation, route resolution, request policy execution, origin invocation, response policy handling, analytics, and error handling are intertwined. This makes the gateway harder to change safely and hides hot-path inefficiencies behind duplicated setup logic.

## What Changes

- Redesign the core gateway execution path around explicit pipeline stages instead of a single monolithic `fetch` implementation.
- Consolidate route and policy handler compilation so request and response policy resolution follow one consistent model.
- Define gateway execution requirements for route matching, request policy short-circuiting, origin invocation, response policy application, and terminal response handling.
- Allow targeted behavioral cleanup where the current control flow is ambiguous, while keeping the gateway's route-driven model intact.

## Capabilities

### New Capabilities
- `gateway-pipeline`: Defines how the worker compiles configured routes and policies into an executable request pipeline, and how requests move through route resolution, request policies, origin handling, response policies, analytics, and terminal responses.

### Modified Capabilities

## Impact

- Affected code: `src/index.ts`, shared gateway types, route/policy wiring, and analytics integration points.
- Affected behavior: gateway request execution order, short-circuit handling, and response finalization semantics.
- Affected systems: Cloudflare Worker runtime execution and configuration-driven routing behavior.
