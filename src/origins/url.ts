import { ErrorResponse } from "../helpers/response";
import { createOriginLogContext } from "../gateway/logging";
import { TOriginHandler } from "../types";
import { closed } from "../config/schema-helpers";
import { OriginTimeoutError, forward, stripPathPrefix, toGatewayResponse } from "./forward";

type UrlOptions = {
  url: string;
  stripPrefix?: string;
  // Deprecated alias for stripPrefix.
  pathRewrite?: string;
  timeout?: number;
};

const buildOriginUrl = (requestUrl: URL, options: UrlOptions, prefix: string | undefined): string => {
  const originUrl = new URL(options.url);
  const suffix = stripPathPrefix(requestUrl.pathname, prefix);
  const isRootOriginPath = originUrl.pathname === "/" || originUrl.pathname === "";

  if (suffix && isRootOriginPath) {
    originUrl.pathname = suffix;
  }

  originUrl.search = requestUrl.search;
  return originUrl.toString();
};

export const url: TOriginHandler<UrlOptions> = async (
  request: Request,
  options: UrlOptions,
  ctx,
) => {
  const requestUrl = new URL(request.url);
  const prefix = options.stripPrefix ?? options.pathRewrite;

  try {
    const response = await forward(
      request,
      buildOriginUrl(requestUrl, options, prefix),
      request.body,
      options.timeout,
    );
    return toGatewayResponse(response, requestUrl, [options.url], prefix, () =>
      ctx.log({
        level: "error",
        stage: "origin_rewrite",
        outcome: "failed",
        ...createOriginLogContext(request, "url"),
      }),
    );
  } catch (error) {
    const timedOut = error instanceof OriginTimeoutError;
    ctx.log({
      level: "error",
      stage: "origin",
      outcome: timedOut ? "timed_out" : "request_failed",
      ...createOriginLogContext(request, "url"),
    });
    return timedOut
      ? new ErrorResponse("Origin request timed out", 504)
      : new ErrorResponse("Origin request failed", 502);
  }
};

url.optionsSchema = {
  ...closed(
    {
      url: { type: "string" },
      stripPrefix: { type: "string" },
      pathRewrite: { type: "string" },
      timeout: { type: "number" },
    },
    ["url"],
  ),
  not: { required: ["stripPrefix", "pathRewrite"] },
};
