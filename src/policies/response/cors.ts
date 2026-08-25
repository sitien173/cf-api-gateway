import { TResponsePolicyHandler } from "../../types";

type CorsOptions = {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders?: string[];
  maxAge?: number;
  allowCredentials: boolean;
};

const findAllowedOrigin = (
  request: Request | undefined,
  allowedOrigins: string[],
): string | null => {
  if (allowedOrigins.includes("*")) {
    return "*";
  }

  const requestOrigin = request?.headers.get("origin");
  if (!requestOrigin) {
    return null;
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(requestOrigin);
  } catch {
    return null;
  }

  const requestHostname = requestUrl.hostname.toLowerCase();
  const isDevelopmentOrigin =
    requestOrigin === "http://localhost" || requestOrigin === "http://127.0.0.1";

  for (const allowedOrigin of allowedOrigins) {
    if (!allowedOrigin.startsWith("*.")) {
      continue;
    }

    if (requestUrl.protocol !== "https:" && !isDevelopmentOrigin) {
      continue;
    }

    const suffix = allowedOrigin.slice(2).toLowerCase();
    if (requestHostname !== suffix && requestHostname.endsWith(`.${suffix}`)) {
      return requestOrigin;
    }
  }

  return null;
};

export const cors: TResponsePolicyHandler = (
  response: Response,
  options: CorsOptions,
  request?: Request,
) => {
  const {
    allowedOrigins,
    allowedMethods,
    allowedHeaders,
    exposedHeaders = [],
    maxAge,
    allowCredentials,
  } = options;

  if (allowedOrigins.length !== 1 || allowedOrigins[0] !== "*") {
    response.headers.append("Vary", "Origin");
  }

  const allowedOrigin = findAllowedOrigin(request, allowedOrigins);

  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  }

  if (allowedMethods.length > 0) {
    response.headers.set(
      "Access-Control-Allow-Methods",
      allowedMethods.join(", ")
    );
  }

  if (allowedHeaders.length > 0) {
    const allowHeaders =
      allowCredentials && allowedHeaders.length === 1 && allowedHeaders[0] === "*"
        ? request?.headers.get("access-control-request-headers") ?? "*"
        : allowedHeaders.join(", ");

    response.headers.set("Access-Control-Allow-Headers", allowHeaders);
  }

  if (exposedHeaders.length > 0) {
    response.headers.set(
      "Access-Control-Expose-Headers",
      exposedHeaders.join(", ")
    );
  }

  if (maxAge) {
    response.headers.set("Access-Control-Max-Age", maxAge.toString());
  }

  if (allowCredentials) {
    response.headers.set(
      "Access-Control-Allow-Credentials",
      `${allowCredentials}`
    );
  }

  return response;
};
