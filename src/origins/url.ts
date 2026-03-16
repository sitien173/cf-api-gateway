import { ErrorResponse } from "../helpers/response";
import { createOriginLogContext, emitGatewayLog, toErrorMessage } from "../gateway/logging";
import { IRequest, TOriginHandler } from "../types";

type UrlOptions = {
  url: string;
  pathRewrite?: string;
};

const joinPath = (basePath: string, suffix: string): string => {
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;

  if (!normalizedBase || normalizedBase === "") {
    return normalizedSuffix;
  }

  return `${normalizedBase}${normalizedSuffix}`;
};

const buildOriginUrl = (request: IRequest, options: UrlOptions): string => {
  const requestUrl = new URL(request.url);
  const originUrl = new URL(options.url);

  if (options.pathRewrite && requestUrl.pathname.startsWith(options.pathRewrite)) {
    const suffix = requestUrl.pathname.slice(options.pathRewrite.length);
    const isRootOriginPath =
      originUrl.pathname === "/" || originUrl.pathname === "";

    if (suffix && isRootOriginPath) {
      originUrl.pathname = joinPath(originUrl.pathname, suffix);
    }
  }

  originUrl.search = requestUrl.search;
  return originUrl.toString();
};

export const url: TOriginHandler = async (
  request: IRequest,
  options: UrlOptions
) => {
  const originRequest = new Request(buildOriginUrl(request, options), new Request(request));
  try {
    emitGatewayLog(undefined, {
      level: "info",
      stage: "origin",
      outcome: "started",
      ...createOriginLogContext(request, "url"),
      targetUrl: originRequest.url,
    });

    const originFetch = await fetch(originRequest.url, originRequest);

    emitGatewayLog(undefined, {
      level: "info",
      stage: "origin",
      outcome: "completed",
      ...createOriginLogContext(request, "url"),
      status: originFetch.status,
      targetUrl: originRequest.url,
    });

    return new Response(originFetch.body, originFetch);
  } catch (err) {
    emitGatewayLog(undefined, {
      level: "error",
      stage: "origin",
      outcome: "request_failed",
      ...createOriginLogContext(request, "url"),
      targetUrl: originRequest.url,
      errorMessage: toErrorMessage(err),
    });
    return new ErrorResponse("Origin request failed", 500);
  }
};
