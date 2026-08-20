import { ErrorResponse } from "../helpers/response";
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

const canRetry = (method: string): boolean => retryableMethods.has(method);

const readRequestBody = async (request: IRequest): Promise<ArrayBuffer | undefined> => {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return undefined;
  }

  return request.arrayBuffer();
};

const createUpstreamRequest = (
  request: IRequest,
  targetUrl: string,
  body: ArrayBuffer | undefined,
): Request => {
  const headers = new Headers(request.headers);
  headers.delete("host");

  return new Request(targetUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
};

const fetchUpstream = async (
  request: IRequest,
  targetUrl: string,
  body: ArrayBuffer | undefined,
): Promise<Response> =>
  fetch(createUpstreamRequest(request, targetUrl, body), {
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

export const executeFailover = async ({
  request,
  primaryUrl,
  fallbackUrl,
  primaryHealthy,
  wrapResponse,
  onPrimaryFailure,
  onFallbackStarted,
  onFallbackCompleted,
  onRequestFailed,
  onFallbackFailed,
}: FailoverOptions): Promise<Response> => {
  let body: ArrayBuffer | undefined;

  try {
    body = await readRequestBody(request);
  } catch {
    onRequestFailed?.();
    return new ErrorResponse("All upstreams failed", 503);
  }

  const firstUrl = primaryHealthy ? primaryUrl : fallbackUrl;
  const firstIsPrimary = primaryHealthy;
  let firstResponse: Response;

  try {
    firstResponse = await fetchUpstream(request, firstUrl, body);
  } catch {
    onRequestFailed?.();

    if (!firstIsPrimary || !canRetry(request.method)) {
      return new ErrorResponse("All upstreams failed", 503);
    }

    onFallbackStarted?.();
    let fallbackResponse: Response;
    try {
      fallbackResponse = await fetchUpstream(request, fallbackUrl, body);
    } catch {
      onFallbackFailed?.();
      return new ErrorResponse("All upstreams failed", 503);
    }
    onFallbackCompleted?.(fallbackResponse.status);
    return wrapResponse(new Response(fallbackResponse.body, fallbackResponse));
  }

  if (firstIsPrimary && firstResponse.status >= 500) {
    onPrimaryFailure?.(firstResponse.status);

    if (!canRetry(request.method)) {
      return wrapResponse(new Response(firstResponse.body, firstResponse));
    }

    try {
      await firstResponse.body?.cancel();
    } catch {
      // A failed cancellation must not prevent the single safe retry.
    }
    onFallbackStarted?.();

    let fallbackResponse: Response;
    try {
      fallbackResponse = await fetchUpstream(request, fallbackUrl, body);
    } catch {
      onFallbackFailed?.();
      return new ErrorResponse("All upstreams failed", 503);
    }
    onFallbackCompleted?.(fallbackResponse.status);
    return wrapResponse(new Response(fallbackResponse.body, fallbackResponse));
  }

  return wrapResponse(new Response(firstResponse.body, firstResponse));
};
