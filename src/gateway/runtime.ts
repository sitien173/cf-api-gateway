import { ErrorResponse } from "../helpers/response";
import type { IRequest } from "../types";
import { createLogContext, emitGatewayLog } from "./logging";
import type {
  CompiledGateway,
  CompiledRoute,
  ExecutionDependencies,
  GatewayEnv,
  GatewayExecutionContext,
} from "./types";

const defaultNow = () => Date.now();
const analyticsRouteMissLabel = "route_miss";

const matchesPrefix = (pathname: string, prefix: string): boolean => {
  if (prefix === "/") {
    return pathname.startsWith("/");
  }

  const normalizedPrefix = prefix.endsWith("/")
    ? prefix.slice(0, -1)
    : prefix;

  return (
    pathname === normalizedPrefix ||
    pathname.startsWith(`${normalizedPrefix}/`)
  );
};

const resolveRoute = (
  gateway: CompiledGateway,
  request: Request,
  methodOverride?: string,
): CompiledRoute | undefined => {
  const requestUrl = new URL(request.url);
  const requestMethod = methodOverride ?? request.method;
  return gateway.routes.find((route) => {
    if (route.method !== requestMethod) {
      return false;
    }

    if (route.matchMode === "prefix") {
      return matchesPrefix(requestUrl.pathname, route.path);
    }

    return route.path === requestUrl.pathname;
  });
};

const applyResponsePolicies = async (
  route: CompiledRoute,
  response: Response,
  request: Request,
  dependencies: ExecutionDependencies,
): Promise<Response> => {
  let currentResponse = response;

  for (const policy of route.responsePolicies) {
    const result = await policy.handler(currentResponse, policy.options, request);
    if (result instanceof Response) {
      currentResponse = result;
    }

    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "response_policy",
      outcome: "applied",
      ...createLogContext(request, route),
      policyName: policy.name,
      status: currentResponse.status,
    });
  }

  return currentResponse;
};

const resolvePreflightRoute = (
  gateway: CompiledGateway,
  request: Request,
): CompiledRoute | undefined => {
  if (request.method !== "OPTIONS") {
    return undefined;
  }

  const requestedMethod = request.headers.get("access-control-request-method");
  if (!requestedMethod) {
    return undefined;
  }

  return resolveRoute(gateway, request, requestedMethod);
};

const finalizeResponse = (
  request: Request,
  response: Response,
  env: GatewayEnv,
  ctx: GatewayExecutionContext,
  dependencies: ExecutionDependencies,
  latencyStart: number,
  route?: CompiledRoute,
): Response => {
  const latency = (dependencies.now ?? defaultNow)() - latencyStart;

  const logAnalytics = dependencies.logAnalytics;
  if (logAnalytics) {
    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "analytics",
      outcome: "scheduled",
      ...createLogContext(request, route),
      status: response.status,
      latencyMs: latency,
    });
    const analyticsEvent = {
      routePath: route?.path ?? analyticsRouteMissLabel,
      method: request.method,
      status: response.status,
      latencyMs: latency,
    };
    ctx.waitUntil(
      Promise.resolve().then(() => logAnalytics(analyticsEvent, env)),
    );
  }

  emitGatewayLog(dependencies.logEvent, {
    level: "info",
    stage: "response_finalization",
    outcome: "completed",
    ...createLogContext(request, route),
    status: response.status,
    latencyMs: latency,
  });

  return response;
};

export const executeGatewayRequest = async (
  gateway: CompiledGateway,
  originalRequest: IRequest,
  env: GatewayEnv,
  ctx: GatewayExecutionContext,
  dependencies: ExecutionDependencies = {},
): Promise<Response> => {
  const latencyStart = (dependencies.now ?? defaultNow)();
  let route: CompiledRoute | undefined;
  let isPreflight = false;

  try {
    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "request_received",
      outcome: "received",
      ...createLogContext(originalRequest),
    });

    const preflightRoute = resolvePreflightRoute(gateway, originalRequest);
    isPreflight = preflightRoute !== undefined;
    route = preflightRoute ?? resolveRoute(gateway, originalRequest);

    if (!route) {
      emitGatewayLog(dependencies.logEvent, {
        level: "info",
        stage: "route_resolution",
        outcome: "route_miss",
        ...createLogContext(originalRequest),
        status: 404,
      });

      return finalizeResponse(
        originalRequest,
        new ErrorResponse("Route not found", 404),
        env,
        ctx,
        dependencies,
        latencyStart,
        route,
      );
    }

    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "route_resolution",
      outcome: "matched",
      ...createLogContext(originalRequest, route),
    });

    if (isPreflight) {
      const preflightResponse = await applyResponsePolicies(
        route,
        new Response(null, { status: 204 }),
        originalRequest,
        dependencies,
      );

      return finalizeResponse(
        originalRequest,
        preflightResponse,
        env,
        ctx,
        dependencies,
        latencyStart,
        route,
      );
    }

    let modifiedRequest: IRequest = originalRequest;

    for (const policy of route.requestPolicies) {
      const result = await policy.handler(modifiedRequest, policy.options, env);

      if (result instanceof Response) {
        emitGatewayLog(dependencies.logEvent, {
          level: "info",
          stage: "request_policy",
          outcome: "short_circuit",
          ...createLogContext(originalRequest, route),
          policyName: policy.name,
          status: result.status,
        });

        return finalizeResponse(
          originalRequest,
          result,
          env,
          ctx,
          dependencies,
          latencyStart,
          route,
        );
      }

      emitGatewayLog(dependencies.logEvent, {
        level: "info",
        stage: "request_policy",
        outcome: "continued",
        ...createLogContext(originalRequest, route),
        policyName: policy.name,
      });

      modifiedRequest = result;
    }

    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "origin",
      outcome: "started",
      ...createLogContext(originalRequest, route),
    });

    const originResponse = await route.origin.handler(
      modifiedRequest,
      route.origin.options,
    );
    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "origin",
      outcome: "completed",
      ...createLogContext(originalRequest, route),
      status: originResponse.status,
    });

    const finalResponse = await applyResponsePolicies(
      route,
      originResponse,
      originalRequest,
      dependencies,
    );

    return finalizeResponse(
      originalRequest,
      finalResponse,
      env,
      ctx,
      dependencies,
      latencyStart,
      route,
    );
  } catch {
    emitGatewayLog(dependencies.logEvent, {
      level: "error",
      stage: "execution",
      outcome: "failed",
      ...createLogContext(originalRequest, route),
      status: 500,
    });

    return finalizeResponse(
      originalRequest,
      new ErrorResponse("An error occured.", 500),
      env,
      ctx,
      dependencies,
      latencyStart,
      route,
    );
  }
};
