import { ErrorResponse } from "../helpers/response";
import { emitGatewayLog, toErrorMessage } from "../gateway/logging";
import { IRequest, TOriginHandler } from "../types";

type UrlOptions = {
  url: string;
};

export const url: TOriginHandler = async (
  request: IRequest,
  options: UrlOptions
) => {
  const originRequest = new Request(options.url, new Request(request));
  try {
    const originFetch = await fetch(originRequest.url, originRequest);
    return new Response(originFetch.body, originFetch);
  } catch (err) {
    emitGatewayLog(undefined, {
      level: "error",
      stage: "origin",
      outcome: "request_failed",
      method: request.method,
      path: new URL(request.url).pathname,
      originType: "url",
      targetUrl: originRequest.url,
      errorMessage: toErrorMessage(err),
    });
    return new ErrorResponse("Origin request failed", 500);
  }
};
