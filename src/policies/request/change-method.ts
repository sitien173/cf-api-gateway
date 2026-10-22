import { TRequestPolicyHandler } from "../../types";
import { closed } from "../../config/schema-helpers";

type ChangeMethodOptions = {
  method: string;
};

export const changeMethod: TRequestPolicyHandler<ChangeMethodOptions> = (
  request: Request,
  options: ChangeMethodOptions
) => {
  const headers = new Headers(request.headers);
  const initRequest: RequestInit = {
    method: options.method,
    headers,
    body: request.body,
    cf: request.cf,
    fetcher: request.fetcher,
    redirect: request.redirect,
    signal: request.signal,
  };

  if (options.method === "GET" || options.method === "HEAD") {
    initRequest.body = null;
    headers.delete("Content-Type");
    headers.delete("Content-Length");
  }

  return Promise.resolve(new Request(request.url, initRequest));
};

changeMethod.optionsSchema = closed({ method: { type: "string" } }, ["method"]);
