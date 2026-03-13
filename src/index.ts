import * as requestPolicies from "./policies/request";
import * as responsePolicies from "./policies/response";
import * as gatewayOrigins from "./origins";
import config from "./config.json";
import { compileGateway, executeGatewayRequest } from "./gateway";
import { logAnalytics } from "./services/analytics";
import { IRequest } from "./types";

export interface Env {
  GATEWAY_NAME?: string;
  ANALYTICS_ENABLED?: string;
  [key: string]: any; // for analytics env
}
const gateway = compileGateway(config, {
  requestPolicies,
  responsePolicies,
  origins: gatewayOrigins,
});

export default {
  async fetch(originalRequest: IRequest, env: Env, ctx: ExecutionContext) {
    return executeGatewayRequest(gateway, originalRequest, env, ctx, {
      logAnalytics,
    });
  },
};
