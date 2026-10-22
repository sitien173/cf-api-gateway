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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const resolveRoute = (
  gateway: CompiledGateway,
  request: Request,
  requestUrl: URL,
  methodOverride?: string,
): CompiledRoute | undefined => {
  const requestMethod = methodOverride ?? request.method;
  let rememberedPrefix: CompiledRoute | undefined;
  let prefixMatched = false;
  for (const route of gateway.routes) {
    if (route.method !== requestMethod) continue;
    if (route.matchMode === "exact") {
      if (requestUrl.pathname === route.pattern) return route;
      continue;
    }
    if (route.matchMode === "prefix" || route.matchMode === "prefixStop") {
      if (prefixMatched || !requestUrl.pathname.startsWith(route.pattern)) continue;
      prefixMatched = true;
      if (route.matchMode === "prefixStop") return route;
      rememberedPrefix = route;
      continue;
    }
    if (route.regex?.test(requestUrl.pathname)) return route;
  }
  return rememberedPrefix;
};

const applyResponsePolicies = async (
  route: CompiledRoute,
  response: Response,
  request: Request,
  dependencies: ExecutionDependencies,
): Promise<Response> => {
  let currentResponse = response;

  // Origin handlers must return a constructed Response so policies can safely mutate its headers.
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
  requestUrl: URL,
): CompiledRoute | undefined => {
  if (request.method !== "OPTIONS") {
    return undefined;
  }

  const requestedMethod = request.headers.get("access-control-request-method");
  if (!requestedMethod) {
    return undefined;
  }

  return resolveRoute(gateway, request, requestUrl, requestedMethod);
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
    const analyticsEvent = {
      routePath: route?.path ?? analyticsRouteMissLabel,
      method: request.method,
      status: response.status,
      latencyMs: latency,
    };
    try {
      ctx.waitUntil(Promise.resolve(logAnalytics(analyticsEvent, env)));
    } catch (error) {
      ctx.waitUntil(Promise.reject(error));
    }
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
  const configuredLogEvent = dependencies.logEvent;
  dependencies = {
    ...dependencies,
    logEvent: (event) =>
      emitGatewayLog(configuredLogEvent, event, env),
  };
  const requestUrl = new URL(originalRequest.url);
  let route: CompiledRoute | undefined;
  let isPreflight: boolean;

  try {
    emitGatewayLog(dependencies.logEvent, {
      level: "info",
      stage: "request_received",
      outcome: "received",
      ...createLogContext(originalRequest),
    });

    const preflightRoute = resolvePreflightRoute(
      gateway,
      originalRequest,
      requestUrl,
    );
    isPreflight = preflightRoute !== undefined;
    route =
      preflightRoute ?? resolveRoute(gateway, originalRequest, requestUrl);

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
  } catch (error) {
    emitGatewayLog(dependencies.logEvent, {
      level: "error",
      stage: "execution",
      outcome: "failed",
      ...createLogContext(originalRequest, route),
      status: 500,
      reason: errorMessage(error),
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
