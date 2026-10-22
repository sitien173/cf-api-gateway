import { TRequestPolicyHandler } from "../../types";
import { ErrorResponse } from "../../helpers/response";
import { constantTimeEqual } from "../../helpers/compare";
import { closed } from "../../config/schema-helpers";

type BasicAuthOptions = {
  // Name of the Worker secret that holds "user:password".
  secret: string;
};

const encodeCredentials = (credentials: string): string =>
  btoa(String.fromCodePoint(...new TextEncoder().encode(credentials)));

export const basicAuth: TRequestPolicyHandler<BasicAuthOptions> = (
  request: Request,
  options: BasicAuthOptions,
  env,
) => {
  const credentials = env[options.secret];
  if (typeof credentials !== "string" || credentials === "") {
    return Promise.resolve(new ErrorResponse("Basic auth configuration is missing", 500));
  }

  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return Promise.resolve(new ErrorResponse("Authorization header is missing", 401));
  }
  const basicMatch = /^Basic\s+(\S+)$/i.exec(authHeader.trim());
  if (!basicMatch) {
    return Promise.resolve(new ErrorResponse("Authorization format is incorrect. Correct format: 'Basic {base64({user}:{password})}'", 401));
  }

  const encodedToken = basicMatch[1];
  if (!constantTimeEqual(encodeCredentials(credentials), encodedToken)) {
    return Promise.resolve(new ErrorResponse("Incorrect basic authentication", 401));
  }

    return Promise.resolve(request);
};

basicAuth.optionsSchema = closed(
  { secret: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" } },
  ["secret"],
);
