import { errorMessage } from "../helpers/errors";
import { ErrorResponse } from "../helpers/response";
import { createLogContext, emitGatewayLog } from "./logging";
import { isPrefixRoute, matchesRoutePattern } from "./matching";
import {
  buildMountContextCookie,
  getMountForPath,
  removeMountContextCookie,
  resolveMountRequest,
  rewriteMountSetCookies,
} from "./mounts";
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

// Routes are sorted exact, then prefixes longest first, then regexes in document order.
export const resolveRoute = (
  gateway: CompiledGateway,
  method: string,
  requestUrl: URL,
): CompiledRoute | undefined => {
  const { pathname } = requestUrl;
  let rememberedPrefix: CompiledRoute | undefined;
  let prefixMatched = false;
  for (const route of gateway.routesByMethod.get(method) ?? []) {
    if (isPrefixRoute(route)) {
      if (prefixMatched || !matchesRoutePattern(route, pathname)) continue;
      prefixMatched = true;
      if (route.matchMode === "prefixStop") return route;
      rememberedPrefix = route;
    } else if (matchesRoutePattern(route, pathname)) {
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

const appendResponseHeader = (
  response: Response,
  name: string,
  value: string,
): Response => {
  try {
    response.headers.append(name, value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    if (response.headers.getSetCookie) {
      headers.delete("set-cookie");
      for (const cookie of response.headers.getSetCookie()) {
        headers.append("Set-Cookie", cookie);
      }
    }
    headers.append(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
};

const appendRecoveryVary = (response: Response): Response =>
  appendResponseHeader(response, "Vary", "Referer, Cookie");

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
  let recovered = false;
  let contextMount: string | undefined;
  const finalize = (response: Response, details?: FinalizeDetails): Response => {
    let finalizedResponse = response;
    if (contextMount) {
      finalizedResponse = appendResponseHeader(
        finalizedResponse,
        "Set-Cookie",
        buildMountContextCookie(contextMount),
      );
    }
    if (recovered) finalizedResponse = appendRecoveryVary(finalizedResponse);
    return finalizeResponse(
      originalRequest,
      finalizedResponse,
      env,
      dependencies,
      latencyStart,
      { route, ...details },
    );
  };
  let pipelineRequest = originalRequest;

  try {
    const resolution = resolveMountRequest(
      gateway,
      originalRequest,
      requestUrl,
      (candidateUrl) =>
        resolvePreflightRoute(gateway, originalRequest, candidateUrl) ??
        resolveRoute(gateway, originalRequest.method, candidateUrl),
    );
    route = resolution.route;
    const isNavigation =
      originalRequest.headers.get("sec-fetch-mode")?.toLowerCase() === "navigate";
    contextMount =
      route && isNavigation
        ? getMountForPath(resolution.requestUrl.pathname, gateway.mounts)
        : undefined;
    if (resolution.source) {
      recovered = true;
      log({
        level: "info",
        stage: "mount_recovery",
        outcome: isNavigation ? "redirected" : "dispatched",
        source: resolution.source,
      });
    }
    if (resolution.source && isNavigation) {
      const location = `${resolution.mount}${requestUrl.pathname}${requestUrl.search}`;
      return finalize(
        new Response(null, { status: 307, headers: { Location: location } }),
      );
    }
    if (resolution.source) {
      pipelineRequest = new Request(resolution.requestUrl, originalRequest);
    }
    pipelineRequest = removeMountContextCookie(pipelineRequest, route?.mount);
    const preflightRoute = resolvePreflightRoute(
      gateway,
      pipelineRequest,
      resolution.requestUrl,
    );

    if (!route) {
      return finalize(new ErrorResponse("Route not found", 404), { outcome: "route_miss" });
    }

    if (preflightRoute) {
      return finalize(
        await applyResponsePolicies(
          route.responsePolicies,
          new Response(null, { status: 204 }),
          pipelineRequest,
        ),
      );
    }

    let modifiedRequest: Request = pipelineRequest;

    for (const policy of route.requestPolicies) {
      const result = await policy.handler(modifiedRequest, policy.options, env, (event) =>
        log({ ...event, policyName: policy.name }),
      );

      if (result instanceof Response) {
        return finalize(await applyCorsPolicies(route, result, pipelineRequest), {
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

    const carriesWebSocket = Boolean(
      (originResponse as Response & { webSocket?: unknown }).webSocket,
    );
    const namespacedOriginResponse =
      route.mount && originResponse.status !== 101 && !carriesWebSocket
        ? rewriteMountSetCookies(originResponse, route.mount, dependencies.now ?? defaultNow)
        : originResponse;
    return finalize(
      await applyResponsePolicies(
        route.responsePolicies,
        namespacedOriginResponse,
        pipelineRequest,
      ),
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
        response = await applyCorsPolicies(route, response, pipelineRequest);
      } catch {
        // The original failure is already logged; the 500 goes out without CORS headers.
      }
    }
    return finalize(response);
  }
};
