import * as jose from "jose";
import { ErrorResponse } from "../../helpers/response";
import { IRequest, RequestPolicyEnv, TRequestPolicyHandler } from "../../types";

type RemoteJwkSet = ReturnType<typeof jose.createRemoteJWKSet>;

type NormalizedIssuer = {
  issuer: string;
  jwksUrl: string;
};

const remoteJwkSets = new Map<string, RemoteJwkSet>();
const apiKeyCache = new Map<string, string[]>();

export const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
};

const getValidApiKeys = (raw: unknown): string[] => {
  if (typeof raw !== "string") {
    return [];
  }

  const cached = apiKeyCache.get(raw);
  if (cached) {
    return cached;
  }

  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  apiKeyCache.set(raw, parsed);
  return parsed;
};

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

export const apiKeyOrAuth0: TRequestPolicyHandler = async (
  request: IRequest,
  _options: unknown,
  env: RequestPolicyEnv,
) => {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== null) {
    const presentedApiKey = apiKey.trim();
    const validApiKeys = getValidApiKeys(env.GATEWAY_API_KEY);

    if (validApiKeys.some((validApiKey) => constantTimeEqual(validApiKey, presentedApiKey))) {
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
