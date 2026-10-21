import { IRequest, TRequestPolicyHandler } from "../../types";
import { ErrorResponse } from "../../helpers/response";
import { constantTimeEqual } from "./auth0-jwt";

type basicAuthtOptions = {
  username: string;
  password: string;
};

export const basicAuth: TRequestPolicyHandler<basicAuthtOptions> = async (
  request: IRequest,
  options: basicAuthtOptions
) => {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return new ErrorResponse("Authorization header is missing", 401);
  }
  const basicMatch = /^Basic\s+(\S+)$/i.exec(authHeader.trim());
  if (!basicMatch) {
    return new ErrorResponse("Authorization format is incorrect. Correct format: 'Basic {base64({user}:{password})}'", 401);
  }

  const encodedToken = basicMatch[1];
  if (!constantTimeEqual(btoa(options.username + ":" + options.password), encodedToken)) {
    return new ErrorResponse("Incorrect basic authentication", 401);
  }

    return request;
};
