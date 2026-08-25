import type {
  CompiledRoute,
  GatewayLogger,
  GatewayLogEvent,
} from "./types";

export const createLogContext = (
  request: Request,
  route?: CompiledRoute,
): Pick<GatewayLogEvent, "method" | "routePath" | "routeMethod" | "originType"> => ({
  method: request.method,
  routePath: route?.path,
  routeMethod: route?.method,
  originType: route?.originType,
});

export const createOriginLogContext = (
  request: Request,
  originType: string,
): Pick<GatewayLogEvent, "method" | "originType"> => ({
  method: request.method,
  originType,
});

export const emitGatewayLog = (
  logger: GatewayLogger | undefined,
  event: GatewayLogEvent,
  env?: { GATEWAY_LOG_LEVEL?: string; [key: string]: any },
): void => {
  if (
    event.level === "info" &&
    env?.GATEWAY_LOG_LEVEL?.toLowerCase() === "error"
  ) {
    return;
  }

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
