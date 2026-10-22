import * as requestPolicies from "./policies/request";
import * as responsePolicies from "./policies/response";
import * as gatewayOrigins from "./origins";
import config from "./config.json";
import { createGatewayResolver } from "./config/source";
import { executeGatewayRequest } from "./gateway";
import { finalizeResponse } from "./gateway/runtime";
import { emitGatewayLog } from "./gateway/logging";
import type {
  CompiledGateway,
  ExecutionDependencies,
  GatewayEnv,
} from "./gateway/types";
import { errorMessage } from "./helpers/errors";
import { logAnalytics } from "./services/analytics";
import type { ResolverEnv } from "./config/source";

const gatewayHandlers = {
  requestPolicies,
  responsePolicies,
  origins: gatewayOrigins,
};
const resolver = createGatewayResolver();

export const executeUnavailableRequest = (
  request: Request,
  env: GatewayEnv,
  dependencies?: ExecutionDependencies,
): Response => {
  const resolvedDependencies = dependencies ?? { logAnalytics };
  const latencyStart = (resolvedDependencies.now ?? Date.now)();
  const response = new Response("Gateway configuration unavailable", {
    status: 503,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });

  return finalizeResponse(request, response, env, resolvedDependencies, latencyStart, {
    outcome: "config_unavailable",
  });
};

export default {
  async fetch(originalRequest: Request, env: ResolverEnv, ctx: ExecutionContext) {
    let gateway: CompiledGateway | undefined;
    try {
      gateway = await resolver.resolve(env, ctx, gatewayHandlers, {
        finalCandidate: config,
      });
    } catch (error) {
      emitGatewayLog(undefined, {
        level: "error",
        stage: "config_resolution",
        outcome: "failed",
        reason: errorMessage(error),
      });
      gateway = undefined;
    }

    if (!gateway) {
      return executeUnavailableRequest(originalRequest, env);
    }

    return executeGatewayRequest(gateway, originalRequest, env, ctx, {
      logAnalytics,
    });
  },

  async scheduled(_controller: ScheduledController, env: ResolverEnv) {
    await resolver.refresh(env, gatewayHandlers);
  },
};
