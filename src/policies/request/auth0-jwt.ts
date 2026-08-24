import * as jose from "jose";
import { ErrorResponse } from "../../helpers/response";
import { IRequest, RequestPolicyEnv, TRequestPolicyHandler } from "../../types";

type RemoteJwkSet = ReturnType<typeof jose.createRemoteJWKSet>;

type NormalizedIssuer = {
  issuer: string;
  jwksUrl: string;
};

const remoteJwkSets = new Map<string, RemoteJwkSet>();

const normalizeIssuer = (value: string): NormalizedIssuer | undefined => {
  try {
    const issuerUrl = new URL(value);
    if (issuerUrl.protocol !== "https:") {
      return undefined;
    }

    issuerUrl.pathname = `${issuerUrl.pathname.replace(/\/+$/, "")}/`;
    issuerUrl.search = "";
    issuerUrl.hash = "";

    const issuer = issuerUrl.toString();
    return {
      issuer,
      jwksUrl: new URL(".well-known/jwks.json", issuer).toString(),
    };
  } catch {
    return undefined;
  }
};

const getRemoteJwkSet = (jwksUrl: string): RemoteJwkSet => {
  const cached = remoteJwkSets.get(jwksUrl);
  if (cached) {
    return cached;
  }

  const remoteJwkSet = jose.createRemoteJWKSet(new URL(jwksUrl));
  remoteJwkSets.set(jwksUrl, remoteJwkSet);
  return remoteJwkSet;
};

export const auth0jwt: TRequestPolicyHandler = async (
  request: IRequest,
  _options: unknown,
  env: RequestPolicyEnv,
) => {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== null) {
    const validApiKeys = typeof env.GATEWAY_API_KEY === "string"
      ? env.GATEWAY_API_KEY
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      : [];

    if (validApiKeys.includes(apiKey.trim())) {
      return request;
    }

    return new ErrorResponse("API key is invalid", 401);
  }

  const auth0Issuer = env.AUTH0_ISSUER;
  const auth0Audience = env.AUTH0_AUDIENCE;
  const normalizedIssuer = auth0Issuer ? normalizeIssuer(auth0Issuer) : undefined;

  if (!auth0Issuer || !auth0Audience || !normalizedIssuer) {
    return new ErrorResponse("Auth0 configuration is missing", 500);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new ErrorResponse("Authorization header is missing", 401);
  }

  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!bearerMatch) {
    return new ErrorResponse("Authorization header is not bearer token", 401);
  }

  try {
    const verificationResult = await jose.jwtVerify(
      bearerMatch[1],
      getRemoteJwkSet(normalizedIssuer.jwksUrl),
      {
        issuer: normalizedIssuer.issuer,
        audience: auth0Audience,
      },
    );

    if (typeof verificationResult.payload.sub === "string") {
      request.user = verificationResult.payload.sub;
    }
    return request;
  } catch {
    return new ErrorResponse("JWT verification failed", 401);
  }
};
