import { ErrorResponse } from "../helpers/response";
import type { IRequest } from "../types";
import type {
  CompiledGateway,
  CompiledRoute,
  ExecutionDependencies,
  GatewayEnv,
  GatewayExecutionContext,
} from "./types";

const defaultNow = () => Date.now();

const resolveRoute = (
  gateway: CompiledGateway,
  request: Request,
): CompiledRoute | undefined => {
  const requestUrl = new URL(request.url);

  return gateway.routes.find((route) => {
    if (route.method !== request.method) {
      return false;
    }

    if (route.matchMode === "prefix") {
      return requestUrl.pathname.startsWith(route.path);
    }

    return route.path === requestUrl.pathname;
  });
};

const applyResponsePolicies = async (
  route: CompiledRoute,
  response: Response,
): Promise<Response> => {
  let currentResponse = response;

  for (const policy of route.responsePolicies) {
    const result = await policy.handler(currentResponse, policy.options);
    if (result instanceof Response) {
      currentResponse = result;
    }
  }

  return currentResponse;
};

const finalizeResponse = (
  request: Request,
  response: Response,
  env: GatewayEnv,
  ctx: GatewayExecutionContext,
  dependencies: ExecutionDependencies,
  latencyStart: number,
): Response => {
  const latency = (dependencies.now ?? defaultNow)() - latencyStart;

  if (dependencies.logAnalytics) {
    ctx.waitUntil(dependencies.logAnalytics(request, response, env, latency));
  }

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

  try {
    const route = resolveRoute(gateway, originalRequest);

    if (!route) {
      return finalizeResponse(
        originalRequest,
        new ErrorResponse("Route not found", 404),
        env,
        ctx,
        dependencies,
        latencyStart,
      );
    }

    let modifiedRequest: IRequest = originalRequest;

    for (const policy of route.requestPolicies) {
      const result = await policy.handler(modifiedRequest, policy.options);

      if (result instanceof Response) {
        return finalizeResponse(
          originalRequest,
          result,
          env,
          ctx,
          dependencies,
          latencyStart,
        );
      }

      modifiedRequest = result;
    }

    const originResponse = await route.origin.handler(
      modifiedRequest,
      route.origin.options,
    );
    const finalResponse = await applyResponsePolicies(route, originResponse);

    return finalizeResponse(
      originalRequest,
      finalResponse,
      env,
      ctx,
      dependencies,
      latencyStart,
    );
  } catch (error) {
    console.log(error);

    return finalizeResponse(
      originalRequest,
      new ErrorResponse("An error occured.", 500),
      env,
      ctx,
      dependencies,
      latencyStart,
    );
  }
};
