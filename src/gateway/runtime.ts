import { errorMessage } from "../helpers/errors";
import { ErrorResponse } from "../helpers/response";
import { createLogContext, emitGatewayLog } from "./logging";
import type {
  CompiledGateway,
  CompiledResponsePolicy,
  CompiledRoute,
  ExecutionDependencies,
  GatewayEnv,
  GatewayExecutionContext,
  GatewayLogEvent,
} from "./types";

const defaultNow = () => Date.now();

const isPrefixRoute = (route: CompiledRoute): boolean =>
  route.matchMode === "prefix" || route.matchMode === "prefixStop";

const matchesPattern = (route: CompiledRoute, pathname: string): boolean =>
  route.matchMode === "exact" ? pathname === route.pattern : route.regex?.test(pathname) === true;

// Routes are sorted exact, then prefixes longest first, then regexes in document order.
const resolveRoute = (
  gateway: CompiledGateway,
  method: string,
  requestUrl: URL,
): CompiledRoute | undefined => {
  const { pathname } = requestUrl;
  let rememberedPrefix: CompiledRoute | undefined;
  let prefixMatched = false;
  for (const route of gateway.routesByMethod.get(method) ?? []) {
    if (isPrefixRoute(route)) {
      if (prefixMatched || !pathname.startsWith(route.pattern)) continue;
      prefixMatched = true;
      if (route.matchMode === "prefixStop") return route;
      rememberedPrefix = route;
    } else if (matchesPattern(route, pathname)) {
      return route;
    }
  }
  return rememberedPrefix;
};

// Origin handlers must return a constructed Response so policies can safely mutate its headers.
const applyResponsePolicies = async (
  policies: CompiledResponsePolicy[],
  response: Response,
  request: Request,
): Promise<Response> => {
  let currentResponse = response;

  for (const policy of policies) {
    const result = await policy.handler(currentResponse, policy.options, request);
    if (result instanceof Response) {
      currentResponse = result;
    }
  }

  return currentResponse;
};

// Browsers can read short-circuit and error statuses only when CORS headers are present.
const applyCorsPolicies = (
  route: CompiledRoute,
  response: Response,
  request: Request,
): Promise<Response> =>
  applyResponsePolicies(
    route.responsePolicies.filter((policy) => policy.type === "cors"),
    response,
    request,
  );

const resolvePreflightRoute = (
  gateway: CompiledGateway,
  request: Request,
  requestUrl: URL,
): CompiledRoute | undefined => {
  if (request.method !== "OPTIONS") {
    return undefined;
  }

  const requestedMethod = request.headers.get("access-control-request-method");
  if (!requestedMethod) {
    return undefined;
  }

  return resolveRoute(gateway, requestedMethod, requestUrl);
};

export type FinalizeDetails = {
  route?: CompiledRoute;
  outcome?: "completed" | "short_circuit" | "route_miss" | "config_unavailable";
  policyName?: string;
};

// Emits the single info event for a request and records analytics.
export const finalizeResponse = (
  request: Request,
  response: Response,
  env: GatewayEnv,
  dependencies: ExecutionDependencies,
  latencyStart: number,
  { route, outcome = "completed", policyName }: FinalizeDetails = {},
): Response => {
  const latency = (dependencies.now ?? defaultNow)() - latencyStart;

  if (dependencies.logAnalytics) {
    try {
      dependencies.logAnalytics(
        {
          routePath:
            route?.path ?? (outcome === "config_unavailable" ? outcome : "route_miss"),
          method: request.method,
          status: response.status,
          latencyMs: latency,
        },
        env,
      );
    } catch (error) {
      emitGatewayLog(
        dependencies.logEvent,
        {
          level: "error",
          stage: "analytics",
          outcome: "failed",
          ...createLogContext(request, route),
          reason: errorMessage(error),
        },
        env,
      );
    }
  }

  emitGatewayLog(
    dependencies.logEvent,
    {
      level: "info",
      stage: "response_finalization",
      outcome,
      ...createLogContext(request, route),
      ...(policyName ? { policyName } : {}),
      status: response.status,
      latencyMs: latency,
    },
    env,
  );

  return response;
};

export const executeGatewayRequest = async (
  gateway: CompiledGateway,
  originalRequest: Request,
  env: GatewayEnv,
  ctx: GatewayExecutionContext,
  dependencies: ExecutionDependencies = {},
): Promise<Response> => {
  const latencyStart = (dependencies.now ?? defaultNow)();
  const requestUrl = new URL(originalRequest.url);
  let route: CompiledRoute | undefined;
  const log = (event: GatewayLogEvent): void =>
    emitGatewayLog(
      dependencies.logEvent,
      { ...createLogContext(originalRequest, route), ...event },
      env,
    );
  const finalize = (response: Response, details?: FinalizeDetails): Response =>
    finalizeResponse(originalRequest, response, env, dependencies, latencyStart, {
      route,
      ...details,
    });

  try {
    const preflightRoute = resolvePreflightRoute(gateway, originalRequest, requestUrl);
    route = preflightRoute ?? resolveRoute(gateway, originalRequest.method, requestUrl);

    if (!route) {
      return finalize(new ErrorResponse("Route not found", 404), { outcome: "route_miss" });
    }

    if (preflightRoute) {
      return finalize(
        await applyResponsePolicies(
          route.responsePolicies,
          new Response(null, { status: 204 }),
          originalRequest,
        ),
      );
    }

    let modifiedRequest: Request = originalRequest;

    for (const policy of route.requestPolicies) {
      const result = await policy.handler(modifiedRequest, policy.options, env, (event) =>
        log({ ...event, policyName: policy.name }),
      );

      if (result instanceof Response) {
        return finalize(await applyCorsPolicies(route, result, originalRequest), {
          outcome: "short_circuit",
          policyName: policy.name,
        });
      }

      modifiedRequest = result;
    }

    const originResponse = await route.origin.handler(modifiedRequest, route.origin.options, {
      waitUntil: (promise) => ctx.waitUntil(promise),
      log,
    });

    return finalize(
      await applyResponsePolicies(route.responsePolicies, originResponse, originalRequest),
    );
  } catch (error) {
    log({
      level: "error",
      stage: "execution",
      outcome: "failed",
      status: 500,
      reason: errorMessage(error),
    });

    let response: Response = new ErrorResponse("An error occured.", 500);
    if (route) {
      try {
        response = await applyCorsPolicies(route, response, originalRequest);
      } catch {
        // The original failure is already logged; the 500 goes out without CORS headers.
      }
    }
    return finalize(response);
  }
};
