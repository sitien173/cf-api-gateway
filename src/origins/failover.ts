import { ErrorResponse } from "../helpers/response";
import { createOriginLogContext } from "../gateway/logging";
import { closed } from "../config/schema-helpers";
import type { OriginContext } from "../types";
import {
  OriginTimeoutError,
  forward,
  stripPathPrefix,
  toGatewayResponse,
  type UpstreamBody,
} from "./forward";

type FailoverLifecycle = {
  onPrimaryFailure?: (status: number) => void;
  onFallbackStarted?: () => void;
  onFallbackCompleted?: (status: number) => void;
  onRequestFailed?: () => void;
  onFallbackFailed?: () => void;
};

export type FailoverOptions = FailoverLifecycle & {
  request: Request;
  primaryUrl: string;
  fallbackUrl: string;
  primaryHealthy: boolean;
  timeout?: number;
  wrapResponse: (response: Response) => Response;
};

const retryableMethods = new Set(["GET", "HEAD"]);

type HealthCacheEntry = {
  healthy?: boolean;
  timestamp: number;
  refresh?: Promise<boolean>;
  refreshStartedAt?: number;
};

const healthCache = new Map<string, HealthCacheEntry>();

const healthCacheKey = (url: string, healthPath: string, timeout: number): string =>
  `${url}\u0000${healthPath}\u0000${timeout}`;

const canRetry = (method: string): boolean => retryableMethods.has(method);

const allUpstreamsFailed = (error: unknown): Response =>
  new ErrorResponse("All upstreams failed", error instanceof OriginTimeoutError ? 504 : 502);

export const getHealthStatus = async (
  url: string,
  healthPath: string,
  timeout: number,
  cacheTtl: number,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<boolean> => {
  const now = Date.now();
  const cacheKey = healthCacheKey(url, healthPath, timeout);
  const cached = healthCache.get(cacheKey);

  // A refresh cut off with its invocation never settles, so an old one is replaced.
  if (cached?.refresh && now - (cached.refreshStartedAt ?? 0) < timeout * 2) {
    return cached.healthy ?? cached.refresh;
  }

  if (cached?.healthy !== undefined && now - cached.timestamp < cacheTtl) {
    return cached.healthy;
  }

  const refresh = checkUpstreamHealth(url, healthPath, timeout).then((healthy) => {
    healthCache.set(cacheKey, { healthy, timestamp: Date.now() });
    return healthy;
  });
  healthCache.set(cacheKey, {
    healthy: cached?.healthy,
    timestamp: cached?.timestamp ?? 0,
    refresh,
    refreshStartedAt: now,
  });
  waitUntil(refresh);

  return cached?.healthy ?? refresh;
};

export const checkUpstreamHealth = async (
  baseUrl: string,
  healthPath: string,
  timeout: number,
): Promise<boolean> => {
  const healthUrl = `${baseUrl.replace(/\/$/, "")}${healthPath}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    const healthy = response.ok;
    try {
      await response.body?.cancel();
    } catch {
      // Health status is already determined; body cleanup must not change it.
    }
    return healthy;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};

export type FailoverOriginOptions = {
  primaryUrl: string;
  fallbackUrl: string;
  stripPrefix?: string;
  healthCheckPath?: string;
  healthCheckTimeout?: number;
  healthCheckCacheTtl?: number;
  timeout?: number;
};

export const failoverOptionsSchema = closed(
  {
    primaryUrl: { type: "string" },
    fallbackUrl: { type: "string" },
    stripPrefix: { type: "string" },
    healthCheckPath: { type: "string" },
    healthCheckTimeout: { type: "number" },
    healthCheckCacheTtl: { type: "number" },
    timeout: { type: "number" },
  },
  ["primaryUrl", "fallbackUrl"],
);

export const executeFailoverOrigin = async (
  request: Request,
  options: FailoverOriginOptions,
  originType: string,
  ctx: OriginContext,
) => {
  const {
    primaryUrl,
    fallbackUrl,
    stripPrefix,
    healthCheckPath = "/api/health",
    healthCheckTimeout = 5000,
    healthCheckCacheTtl = 60000,
    timeout,
  } = options;

  const url = new URL(request.url);
  const pathAndQuery = (stripPathPrefix(url.pathname, stripPrefix) ?? url.pathname) + url.search;

  const primaryHealthy = await getHealthStatus(
    primaryUrl,
    healthCheckPath,
    healthCheckTimeout,
    healthCheckCacheTtl,
    ctx.waitUntil,
  );

  if (!primaryHealthy) {
    ctx.log({
      level: "info",
      stage: "origin",
      outcome: "routed_fallback",
      ...createOriginLogContext(request, originType),
    });
  }

  const primaryTargetUrl = `${primaryUrl.replace(/\/$/, "")}${pathAndQuery}`;
  const fallbackTargetUrl = `${fallbackUrl.replace(/\/$/, "")}${pathAndQuery}`;
  const wrapResponse = (response: Response): Response =>
    toGatewayResponse(response, url, [primaryUrl, fallbackUrl], stripPrefix, () =>
      ctx.log({
        level: "error",
        stage: "origin_rewrite",
        outcome: "failed",
        ...createOriginLogContext(request, originType),
      }),
    );

  return executeFailover({
    request,
    primaryUrl: primaryTargetUrl,
    fallbackUrl: fallbackTargetUrl,
    primaryHealthy,
    timeout,
    wrapResponse,
    onPrimaryFailure: (status) => {
      ctx.log({
        level: "info",
        stage: "origin",
        outcome: "primary_failed",
        ...createOriginLogContext(request, originType),
        status,
      });
    },
    onFallbackStarted: () => {
      ctx.log({
        level: "info",
        stage: "origin",
        outcome: "fallback_started",
        ...createOriginLogContext(request, originType),
      });
    },
    onFallbackCompleted: (status) => {
      ctx.log({
        level: "info",
        stage: "origin",
        outcome: "fallback_completed",
        ...createOriginLogContext(request, originType),
        status,
      });
    },
    onRequestFailed: () => {
      ctx.log({
        level: "error",
        stage: "origin",
        outcome: "request_failed",
        ...createOriginLogContext(request, originType),
      });
    },
    onFallbackFailed: () => {
      ctx.log({
        level: "error",
        stage: "origin",
        outcome: "fallback_failed",
        ...createOriginLogContext(request, originType),
      });
    },
  });
};

// Fallback only runs for GET and HEAD, which carry no body.
const fetchFallback = async (
  {
    request,
    fallbackUrl,
    timeout,
    wrapResponse,
    onFallbackStarted,
    onFallbackCompleted,
    onFallbackFailed,
  }: FailoverOptions,
  body: UpstreamBody,
): Promise<Response> => {
  onFallbackStarted?.();
  let fallbackResponse: Response;
  try {
    fallbackResponse = await forward(request, fallbackUrl, body, timeout);
  } catch (error) {
    onFallbackFailed?.();
    return allUpstreamsFailed(error);
  }
  onFallbackCompleted?.(fallbackResponse.status);
  return wrapResponse(fallbackResponse);
};

export const executeFailover = async (
  options: FailoverOptions,
): Promise<Response> => {
  const {
    request,
    primaryUrl,
    fallbackUrl,
    primaryHealthy,
    timeout,
    wrapResponse,
    onPrimaryFailure,
    onRequestFailed,
  } = options;
  const shouldRetry = canRetry(request.method);
  const body: UpstreamBody = shouldRetry ? undefined : request.body;

  const firstUrl = primaryHealthy ? primaryUrl : fallbackUrl;
  const firstIsPrimary = primaryHealthy;
  let firstResponse: Response;

  try {
    firstResponse = await forward(request, firstUrl, body, timeout);
  } catch (error) {
    onRequestFailed?.();

    if (!firstIsPrimary || !shouldRetry) {
      return allUpstreamsFailed(error);
    }

    return fetchFallback(options, body);
  }

  if (firstIsPrimary && firstResponse.status >= 500) {
    onPrimaryFailure?.(firstResponse.status);

    if (!shouldRetry) {
      return wrapResponse(firstResponse);
    }

    try {
      await firstResponse.body?.cancel();
    } catch {
      // A failed cancellation must not prevent the single safe retry.
    }
    return fetchFallback(options, body);
  }

  return wrapResponse(firstResponse);
};
