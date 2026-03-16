import type { CompiledRoute, GatewayLogger, GatewayLogEvent } from "./types";

const redactedHeaderNames = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-license-key",
]);

const isSensitiveHeader = (headerName: string): boolean => {
  const normalizedName = headerName.toLowerCase();

  if (redactedHeaderNames.has(normalizedName)) {
    return true;
  }

  return normalizedName.includes("token") || normalizedName.includes("secret");
};

const summarizeHeaders = (headers: Headers): Record<string, string> =>
  Object.fromEntries(
    Array.from(headers.entries()).map(([name, value]) => [
      name,
      isSensitiveHeader(name) ? "[REDACTED]" : value,
    ]),
  );

const summarizeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
};

export const createLogContext = (
  request: Request,
  route?: CompiledRoute,
): Pick<
  GatewayLogEvent,
  "method" | "path" | "query" | "params" | "headers" | "routePath" | "routeMethod" | "originType"
> => {
  const requestUrl = new URL(request.url);

  return {
    method: request.method,
    path: requestUrl.pathname,
    query: requestUrl.search,
    params: Object.fromEntries(requestUrl.searchParams.entries()),
    headers: summarizeHeaders(request.headers),
    routePath: route?.path,
    routeMethod: route?.method,
    originType: route?.originType,
  };
};

export const createOriginLogContext = (
  request: Request,
  originType: string,
): Pick<GatewayLogEvent, "method" | "path" | "query" | "params" | "headers" | "originType"> => {
  const requestUrl = new URL(request.url);

  return {
    method: request.method,
    path: requestUrl.pathname,
    query: requestUrl.search,
    params: Object.fromEntries(requestUrl.searchParams.entries()),
    headers: summarizeHeaders(request.headers),
    originType,
  };
};

export const emitGatewayLog = (
  logger: GatewayLogger | undefined,
  event: GatewayLogEvent,
): void => {
  if (logger) {
    logger(event);
    return;
  }

  if (event.level === "error") {
    console.error(event);
    return;
  }

  console.info(event);
};

export const toErrorMessage = summarizeError;
