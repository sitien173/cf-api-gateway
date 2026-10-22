export const defaultOriginTimeout = 5000;

export class OriginTimeoutError extends Error {
  constructor() {
    super("Origin request timed out");
    this.name = "OriginTimeoutError";
  }
}

export type UpstreamBody = ReadableStream<Uint8Array> | null | undefined;

// The timeout covers the wait for response headers; redirects pass through to the client.
export const forward = async (
  request: Request,
  targetUrl: string,
  body: UpstreamBody,
  timeoutMs = defaultOriginTimeout,
): Promise<Response> => {
  const headers = new Headers(request.headers);
  headers.delete("host");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(
      new Request(targetUrl, {
        method: request.method,
        headers,
        body,
        ...(body ? { duplex: "half" as const } : {}),
        redirect: "manual",
        signal: controller.signal,
      }),
    );
  } catch (error) {
    if (controller.signal.aborted) throw new OriginTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

// Matches only at a path segment boundary, so /v3 strips /v3/a but not /v3x/a.
export const stripPathPrefix = (
  pathname: string,
  prefix: string | undefined,
): string | undefined => {
  if (!prefix) return undefined;
  const base = prefix.replace(/\/$/, "");
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  return pathname.slice(base.length) || "/";
};

const rewriteLocation = (
  location: string,
  gatewayUrl: URL,
  upstreamUrls: string[],
  prefix: string | undefined,
): string => {
  const base = prefix?.replace(/\/$/, "") ?? "";
  let locationUrl: URL;
  try {
    locationUrl = new URL(location);
  } catch {
    if (location.startsWith("/") && prefix && !location.startsWith(prefix)) {
      return base + location;
    }
    return location;
  }

  const upstreamHosts = upstreamUrls.map((upstreamUrl) => new URL(upstreamUrl).hostname);
  if (!upstreamHosts.includes(locationUrl.hostname)) return location;
  return `${gatewayUrl.origin}${base}${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`;
};

// Redirects to an upstream host point back through the gateway so origin hosts stay hidden.
export const toGatewayResponse = (
  response: Response,
  gatewayUrl: URL,
  upstreamUrls: string[],
  prefix: string | undefined,
  onRewriteFailed: () => void,
): Response => {
  const headers = new Headers(response.headers);
  const location = headers.get("Location");
  if (location) {
    try {
      headers.set("Location", rewriteLocation(location, gatewayUrl, upstreamUrls, prefix));
    } catch {
      onRewriteFailed();
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
