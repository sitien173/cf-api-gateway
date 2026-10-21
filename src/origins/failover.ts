import { ErrorResponse } from "../helpers/response";
import { createOriginLogContext, emitGatewayLog } from "../gateway/logging";
import type { IRequest } from "../types";

type FailoverLifecycle = {
  onPrimaryFailure?: (status: number) => void;
  onFallbackStarted?: () => void;
  onFallbackCompleted?: (status: number) => void;
  onRequestFailed?: () => void;
  onFallbackFailed?: () => void;
};

export type FailoverOptions = FailoverLifecycle & {
  request: IRequest;
  primaryUrl: string;
  fallbackUrl: string;
  primaryHealthy: boolean;
  wrapResponse: (response: Response) => Response;
};

const retryableMethods = new Set(["GET", "HEAD"]);

type HealthCacheEntry = {
  healthy?: boolean;
  timestamp: number;
  refresh?: Promise<boolean>;
};

const healthCache = new Map<string, HealthCacheEntry>();

const healthCacheKey = (url: string, healthPath: string, timeout: number): string =>
  `${url}\u0000${healthPath}\u0000${timeout}`;

const canRetry = (method: string): boolean => retryableMethods.has(method);

export const getHealthStatus = async (
  url: string,
  healthPath: string,
  timeout: number,
  cacheTtl: number,
): Promise<boolean> => {
  const now = Date.now();
  const cacheKey = healthCacheKey(url, healthPath, timeout);
  const cached = healthCache.get(cacheKey);

  if (cached?.refresh) {
    return cached.healthy ?? cached.refresh;
  }

  if (cached?.healthy !== undefined && now - cached.timestamp < cacheTtl) {
    return cached.healthy;
  }

  const refresh = checkUpstreamHealth(url, healthPath, timeout).then((healthy) => {
    healthCache.set(cacheKey, { healthy, timestamp: Date.now() });
    return healthy;
  });
  const entry: HealthCacheEntry = {
    healthy: cached?.healthy,
    timestamp: cached?.timestamp ?? 0,
    refresh,
  };
  healthCache.set(cacheKey, entry);

  if (cached?.healthy !== undefined) {
    void refresh;
    return cached.healthy;
  }

  return refresh;
};

const readRequestBody = async (request: IRequest): Promise<ArrayBuffer | undefined> => {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return undefined;
  }

  return request.arrayBuffer();
};

type UpstreamBody = ArrayBuffer | ReadableStream<Uint8Array> | null | undefined;

const createUpstreamRequest = (
  request: IRequest,
  targetUrl: string,
  body: UpstreamBody,
  streamBody: boolean,
): Request => {
  const headers = new Headers(request.headers);
  headers.delete("host");

  return new Request(targetUrl, {
    method: request.method,
    headers,
    body,
    ...(streamBody && body ? { duplex: "half" as const } : {}),
    redirect: "manual",
  });
};

const fetchUpstream = async (
  request: IRequest,
  targetUrl: string,
  body: UpstreamBody,
  streamBody: boolean,
): Promise<Response> =>
  fetch(createUpstreamRequest(request, targetUrl, body, streamBody), {
    redirect: "manual",
  });

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
};

const rewriteLocation = (
  location: string | null,
  gatewayUrl: URL,
  primaryUrl: string,
  fallbackUrl: string,
  stripPrefix: string | undefined,
  originType: string,
): string | null => {
  if (!location) return null;

  try {
    const primary = new URL(primaryUrl);
    const fallback = new URL(fallbackUrl);

    let locUrl: URL;
    try {
      locUrl = new URL(location);
    } catch {
      if (location.startsWith("/") && stripPrefix && !location.startsWith(stripPrefix)) {
        return stripPrefix.replace(/\/$/, "") + location;
      }
      return location;
    }

    const isPrimary = locUrl.hostname === primary.hostname;
    const isFallback = locUrl.hostname === fallback.hostname;

    if (isPrimary || isFallback) {
      const prefix = stripPrefix || "";
      const newPath = prefix.replace(/\/$/, "") + locUrl.pathname + locUrl.search + locUrl.hash;
      return `${gatewayUrl.origin}${newPath}`;
    }

    return location;
  } catch {
    emitGatewayLog(undefined, {
      level: "error",
      stage: "origin_rewrite",
      outcome: "failed",
      ...createOriginLogContext(new Request(gatewayUrl.toString()), originType),
    });
    return location;
  }
};

export const executeFailoverOrigin = async (
  request: IRequest,
  options: FailoverOriginOptions,
  originType: string,
) => {
  const {
    primaryUrl,
    fallbackUrl,
    stripPrefix,
    healthCheckPath = "/api/health",
    healthCheckTimeout = 5000,
    healthCheckCacheTtl = 60000,
  } = options;

  const url = new URL(request.url);
  let pathAndQuery = url.pathname + url.search;

  if (stripPrefix && pathAndQuery.startsWith(stripPrefix)) {
    pathAndQuery = pathAndQuery.substring(stripPrefix.length);
    if (!pathAndQuery.startsWith("/")) {
      pathAndQuery = `/${pathAndQuery}`;
    }
  }

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
    ...createOriginLogContext(request, originType),
  });

  const primaryTargetUrl = `${primaryUrl.replace(/\/$/, "")}${pathAndQuery}`;
  const fallbackTargetUrl = `${fallbackUrl.replace(/\/$/, "")}${pathAndQuery}`;
  const wrapResponse = (response: Response): Response => {
    const responseHeaders = new Headers(response.headers);
    const location = responseHeaders.get("Location");
    if (location) {
      const newLocation = rewriteLocation(
        location,
        url,
        primaryUrl,
        fallbackUrl,
        stripPrefix,
        originType,
      );
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
        ...createOriginLogContext(request, originType),
        status,
      });
    },
    onFallbackStarted: () => {
      emitGatewayLog(undefined, {
        level: "info",
        stage: "origin",
        outcome: "fallback_started",
        ...createOriginLogContext(request, originType),
      });
    },
    onFallbackCompleted: (status) => {
      emitGatewayLog(undefined, {
        level: "info",
        stage: "origin",
        outcome: "fallback_completed",
        ...createOriginLogContext(request, originType),
        status,
      });
    },
    onRequestFailed: () => {
      emitGatewayLog(undefined, {
        level: "error",
        stage: "origin",
        outcome: "request_failed",
        ...createOriginLogContext(request, originType),
      });
    },
    onFallbackFailed: () => {
      emitGatewayLog(undefined, {
        level: "error",
        stage: "origin",
        outcome: "fallback_failed",
        ...createOriginLogContext(request, originType),
      });
    },
  });
};

// Fallback only runs for retryable methods, whose body is already buffered.
const fetchFallback = async (
  {
    request,
    fallbackUrl,
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
    fallbackResponse = await fetchUpstream(request, fallbackUrl, body, false);
  } catch {
    onFallbackFailed?.();
    return new ErrorResponse("All upstreams failed", 503);
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
    wrapResponse,
    onPrimaryFailure,
    onRequestFailed,
  } = options;
  const shouldRetry = canRetry(request.method);
  let body: UpstreamBody;

  try {
    body = shouldRetry ? await readRequestBody(request) : request.body;
  } catch {
    onRequestFailed?.();
    return new ErrorResponse("All upstreams failed", 503);
  }

  const firstUrl = primaryHealthy ? primaryUrl : fallbackUrl;
  const firstIsPrimary = primaryHealthy;
  let firstResponse: Response;

  try {
    firstResponse = await fetchUpstream(
      request,
      firstUrl,
      body,
      !shouldRetry && body !== null && body !== undefined,
    );
  } catch {
    onRequestFailed?.();

    if (!firstIsPrimary || !shouldRetry) {
      return new ErrorResponse("All upstreams failed", 503);
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
