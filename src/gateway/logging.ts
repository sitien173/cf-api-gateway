import type { CompiledRoute, GatewayLogger, GatewayLogEvent } from "./types";

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
): Pick<GatewayLogEvent, "method" | "path" | "routePath" | "routeMethod" | "originType"> => ({
  method: request.method,
  path: new URL(request.url).pathname,
  routePath: route?.path,
  routeMethod: route?.method,
  originType: route?.originType,
});

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
