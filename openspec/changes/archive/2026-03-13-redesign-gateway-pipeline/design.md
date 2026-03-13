## Context

The gateway currently compiles policy maps and routes at module load in `src/index.ts`, then executes request matching, request policy short-circuiting, origin forwarding, response policy application, analytics logging, and terminal error handling inside one `fetch` function. This makes the main request path difficult to reason about, duplicates config-to-handler compilation logic for request and response policies, and couples analytics/error handling to each branch in the control flow.

This change introduces a clearer gateway pipeline while keeping the existing configuration-driven deployment model and Cloudflare Worker runtime. The design must support the current route and policy concepts, preserve the ability for request policies to return an early `Response`, and keep analytics logging attached to all terminal outcomes.

## Goals / Non-Goals

**Goals:**
- Split the runtime into explicit pipeline stages for route resolution, request policy execution, origin invocation, response policy application, and terminal response finalization.
- Compile config into a single typed gateway model so policy and origin handlers are resolved once and stored consistently.
- Centralize terminal response handling so normal responses, route misses, request-policy short-circuits, and internal failures all flow through one analytics/finalization path.
- Make the execution model testable in units without requiring the full worker entrypoint.

**Non-Goals:**
- Redesign the external configuration format in `src/config.json`.
- Introduce new policy types, origin types, or analytics backends.
- Change the Worker deployment model, Wrangler setup, or route semantics beyond the documented cleanup in the new spec.

## Decisions

### Decision: Introduce a compiled gateway model
The gateway SHALL compile raw config into a typed in-memory model that contains resolved route definitions, request policy handlers, response policy handlers, and origin handlers. This removes the current split `requestPoliciesMap` / `responsePoliciesMap` setup and keeps all resolution failures at startup instead of during request handling.

Alternative considered: leave config resolution in `fetch` and extract only helper functions. Rejected because it keeps the same duplicated startup logic and leaves handler lookup semantics implicit.

### Decision: Execute requests through discrete pipeline helpers
The runtime SHALL separate route matching, request policy execution, origin invocation, response policy execution, and response finalization into dedicated helpers or modules. Each stage will consume typed inputs and return a typed result so the entrypoint becomes an orchestration layer rather than the implementation.

Alternative considered: use one stateful class to manage the whole request lifecycle. Rejected because the current codebase is function-oriented and simple stateless helpers will fit the Worker runtime and existing module layout better.

### Decision: Standardize terminal response finalization
All terminal outcomes SHALL go through one finalization path that computes latency, triggers analytics, and returns the final `Response`. This applies to route misses, request policy short-circuits, successful origin responses, and unhandled errors.

Alternative considered: keep analytics calls inline in each branch. Rejected because the current duplication is one of the core maintainability problems and makes redesign riskier.

### Decision: Preserve route-driven processing with narrow behavioral cleanup
The pipeline SHALL retain the current route-driven model and support exact-path or prefix-path matching as determined by origin type, but it may tighten ambiguous behavior around response policy ordering and terminal handling if the new behavior is explicitly captured in the spec.

Alternative considered: redesign routing semantics entirely. Rejected because the requested change targets execution clarity and maintainability, not a new routing product.

## Risks / Trade-offs

- [Pipeline split introduces extra abstraction] -> Keep helpers coarse-grained and aligned with observable execution stages rather than creating tiny wrappers.
- [Startup compilation becomes stricter] -> Fail fast with clear errors for unresolved policy or origin handlers so misconfiguration is easier to diagnose.
- [Behavior cleanup may reveal undocumented assumptions] -> Capture any intentional changes in the capability spec and keep task-level verification focused on route miss, short-circuit, success, and failure paths.
- [Analytics centralization could miss edge branches during refactor] -> Require a single response finalizer and verify all terminal outcomes route through it.

## Migration Plan

Implementation can ship as an internal refactor within the existing worker entrypoint because configuration shape and deployment boundaries remain the same. Rollback is straightforward: revert the pipeline extraction and compiled gateway model while keeping the previous `src/index.ts` execution path.

## Open Questions

None. The change will proceed with the existing configuration model and a functional pipeline architecture.
