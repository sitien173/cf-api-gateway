import { emitGatewayLog } from "../gateway/logging";
import type { AnalyticsEvent, GatewayEnv } from "../gateway/types";

let missingBindingLogged = false;

export const logAnalytics = (event: AnalyticsEvent, env: GatewayEnv): void => {
  if (env.ANALYTICS_ENABLED !== "true") return;

  if (!env.GATEWAY_NAME || !env.API_ANALYTICS) {
    // Once per isolate, so a missing binding does not add a log event to every request.
    if (!missingBindingLogged) {
      missingBindingLogged = true;
      emitGatewayLog(undefined, { level: "error", stage: "analytics", outcome: "binding_missing" }, env);
    }
    return;
  }

  env.API_ANALYTICS.writeDataPoint({
    indexes: [env.GATEWAY_NAME],
    blobs: [event.routePath, event.method],
    doubles: [event.status, event.latencyMs],
  });
};
