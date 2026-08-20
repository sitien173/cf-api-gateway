import { createOriginLogContext, emitGatewayLog } from "../gateway/logging";
import { checkUpstreamHealth, executeFailover } from "./failover";
import { IRequest, TOriginHandler } from "../types";

type HealthCheckResult = {
  healthy: boolean;
  timestamp: number;
};

type UpstreamWithFallbackOptions = {
  primaryUrl: string;
  fallbackUrl: string;
  healthCheckPath?: string;
  healthCheckTimeout?: number;
  healthCheckCacheTtl?: number;
};

const healthCache = new Map<string, HealthCheckResult>();

function rewriteLocation(
  location: string | null,
  gatewayUrl: URL,
  primaryUrl: string,
  fallbackUrl: string,
): string | null {
  if (!location) return null;

  try {
    const primary = new URL(primaryUrl);
    const fallback = new URL(fallbackUrl);

    let locUrl: URL;
    try {
      locUrl = new URL(location);
    } catch {
      return location;
    }

    const isPrimary = locUrl.hostname === primary.hostname;
    const isFallback = locUrl.hostname === fallback.hostname;

    if (isPrimary || isFallback) {
      const newPath = locUrl.pathname + locUrl.search + locUrl.hash;
      return `${gatewayUrl.origin}${newPath}`;
    }

    return location;
  } catch {
    emitGatewayLog(undefined, {
      level: "error",
      stage: "origin_rewrite",
      outcome: "failed",
      ...createOriginLogContext(new Request(gatewayUrl.toString()), "upstreamWithFallback"),
    });
    return location;
  }
}

const getHealthStatus = async (
  url: string,
  healthPath: string,
  timeout: number,
  cacheTtl: number,
): Promise<boolean> => {
  const now = Date.now();
  const cached = healthCache.get(url);

  if (cached && now - cached.timestamp < cacheTtl) {
    return cached.healthy;
  }

  const healthy = await checkUpstreamHealth(url, healthPath, timeout);
  healthCache.set(url, { healthy, timestamp: now });
  return healthy;
};

export const upstreamWithFallback: TOriginHandler = async (
  request: IRequest,
  options: UpstreamWithFallbackOptions,
) => {
  const {
    primaryUrl,
    fallbackUrl,
    healthCheckPath = "/api/health",
    healthCheckTimeout = 5000,
    healthCheckCacheTtl = 60000,
  } = options;

  const url = new URL(request.url);
  const pathAndQuery = url.pathname + url.search;
  const primaryHealthy = await getHealthStatus(
    primaryUrl,
    healthCheckPath,
    healthCheckTimeout,
    healthCheckCacheTtl,
  );

  emitGatewayLog(undefined, {
    level: "info",
    stage: "origin",
    outcome: primaryHealthy ? "routed_primary" : "routed_fallback",
    ...createOriginLogContext(request, "upstreamWithFallback"),
  });

  const primaryTargetUrl = `${primaryUrl.replace(/\/$/, "")}${pathAndQuery}`;
  const fallbackTargetUrl = `${fallbackUrl.replace(/\/$/, "")}${pathAndQuery}`;
  const wrapResponse = (response: Response): Response => {
    const responseHeaders = new Headers(response.headers);
    const location = responseHeaders.get("Location");
    if (location) {
      const newLocation = rewriteLocation(location, url, primaryUrl, fallbackUrl);
      if (newLocation) responseHeaders.set("Location", newLocation);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  };

  return executeFailover({
    request,
    primaryUrl: primaryTargetUrl,
    fallbackUrl: fallbackTargetUrl,
    primaryHealthy,
    wrapResponse,
    onPrimaryFailure: (status) => {
      emitGatewayLog(undefined, {
        level: "info",
        stage: "origin",
        outcome: "primary_failed",
        ...createOriginLogContext(request, "upstreamWithFallback"),
        status,
      });
    },
    onFallbackStarted: () => {
      emitGatewayLog(undefined, {
        level: "info",
        stage: "origin",
        outcome: "fallback_started",
        ...createOriginLogContext(request, "upstreamWithFallback"),
      });
    },
    onFallbackCompleted: (status) => {
      emitGatewayLog(undefined, {
        level: "info",
        stage: "origin",
        outcome: "fallback_completed",
        ...createOriginLogContext(request, "upstreamWithFallback"),
        status,
      });
    },
    onRequestFailed: () => {
      emitGatewayLog(undefined, {
        level: "error",
        stage: "origin",
        outcome: "request_failed",
        ...createOriginLogContext(request, "upstreamWithFallback"),
      });
    },
    onFallbackFailed: () => {
      emitGatewayLog(undefined, {
        level: "error",
        stage: "origin",
        outcome: "fallback_failed",
        ...createOriginLogContext(request, "upstreamWithFallback"),
      });
    },
  });
};
