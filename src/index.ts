import * as requestPolicies from "./policies/request";
import * as responsePolicies from "./policies/response";
import * as gatewayOrigins from "./origins";
import config from "./config.json";
import { createGatewayResolver } from "./config/source";
import { ErrorResponse } from "./helpers/response";
import { executeGatewayRequest } from "./gateway";
import { emitGatewayLog } from "./gateway/logging";
import type {
  CompiledGateway,
  ExecutionDependencies,
} from "./gateway/types";
import { logAnalytics } from "./services/analytics";
import { IRequest } from "./types";

export interface Env {
  AUTH0_ISSUER?: string;
  AUTH0_AUDIENCE?: string;
  GATEWAY_NAME?: string;
  CONFIGCAT_SDK_KEY?: string;
  GATEWAY_CONFIG: KVNamespace;
  ANALYTICS_ENABLED?: string;
  API_ANALYTICS?: AnalyticsEngineDataset;
  [key: string]: any; // for analytics env
}

const gatewayHandlers = {
  requestPolicies,
  responsePolicies,
  origins: gatewayOrigins,
};
const resolver = createGatewayResolver();

const createUnavailableGateway = (request: IRequest): CompiledGateway => ({
  routes: [
    {
      path: new URL(request.url).pathname,
      method: request.method,
      originType: "configuration-unavailable",
      matchMode: "exact",
      origin: {
        handler: async () => new ErrorResponse("Gateway configuration unavailable", 503),
      },
      requestPolicies: [],
      responsePolicies: [],
    },
  ],
});

export const executeUnavailableRequest = (
  originalRequest: IRequest,
  env: Env,
  ctx: ExecutionContext,
  dependencies: ExecutionDependencies = { logAnalytics },
): Promise<Response> => {
  const executionRequest =
    originalRequest.method === "OPTIONS"
      ? (new Request(originalRequest.url, {
          method: "GET",
          headers: originalRequest.headers,
        }) as IRequest)
      : originalRequest;
  const logEvent = (event: Parameters<NonNullable<ExecutionDependencies["logEvent"]>>[0]) => {
    const mappedEvent = { ...event, method: originalRequest.method };
    if (dependencies.logEvent) {
      dependencies.logEvent(mappedEvent);
    } else {
      emitGatewayLog(undefined, mappedEvent);
    }
  };
  const logAnalyticsDependency = dependencies.logAnalytics
    ? (event: Parameters<NonNullable<ExecutionDependencies["logAnalytics"]>>[0], analyticsEnv: Parameters<NonNullable<ExecutionDependencies["logAnalytics"]>>[1]) =>
        dependencies.logAnalytics!({ ...event, method: originalRequest.method }, analyticsEnv)
    : undefined;

  return executeGatewayRequest(
    createUnavailableGateway(executionRequest),
    executionRequest,
    env,
    ctx,
    {
      ...dependencies,
      logEvent,
      logAnalytics: logAnalyticsDependency,
    },
  );
};

export default {
  async fetch(originalRequest: IRequest, env: Env, ctx: ExecutionContext) {
    let gateway: CompiledGateway | undefined;
    try {
      gateway = await resolver.resolve(env, ctx, gatewayHandlers, {
        finalCandidate: config,
      });
    } catch {
      gateway = undefined;
    }

    if (!gateway) {
      return executeUnavailableRequest(originalRequest, env, ctx);
    }

    return executeGatewayRequest(gateway, originalRequest, env, ctx, {
      logAnalytics,
    });
  },
};
