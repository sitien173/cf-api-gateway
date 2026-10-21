import type { AnalyticsEvent, GatewayEnv } from "../gateway/types";

export const logAnalytics = (
  event: AnalyticsEvent,
  env: GatewayEnv,
): Promise<void> => {
  if (!env.GATEWAY_NAME || !env.API_ANALYTICS) {
    console.error("Analytics Engine binding is not configured");
    return Promise.resolve();
  }

  if (env.ANALYTICS_ENABLED !== "true") {
    console.log("Analytics are not logged in non-production environments");
    return Promise.resolve();
  }

  env.API_ANALYTICS.writeDataPoint({
    indexes: [env.GATEWAY_NAME],
    blobs: [event.routePath, event.method],
    doubles: [event.status, event.latencyMs],
  });
  return Promise.resolve();
};
