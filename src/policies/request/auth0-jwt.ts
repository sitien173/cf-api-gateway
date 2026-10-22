import * as jose from "jose";
import { constantTimeEqual } from "../../helpers/compare";
import { ErrorResponse } from "../../helpers/response";
import { TRequestPolicyHandler } from "../../types";
import { closed } from "../../config/schema-helpers";

type RemoteJwkSet = ReturnType<typeof jose.createRemoteJWKSet>;

type NormalizedIssuer = {
  issuer: string;
  jwksUrl: string;
};

const remoteJwkSets = new Map<string, RemoteJwkSet>();
const apiKeyCache = new Map<string, string[]>();

const getValidApiKeys = (raw: string | undefined): string[] => {
  if (raw === undefined) {
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

    while (issuerUrl.pathname.length > 1 && issuerUrl.pathname.endsWith("/")) {
      issuerUrl.pathname = issuerUrl.pathname.slice(0, -1);
    }
    if (!issuerUrl.pathname.endsWith("/")) {
      issuerUrl.pathname += "/";
    }
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
  request,
  _options,
  env,
) => {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== null) {
    const presentedApiKey = apiKey.trim();
    const validApiKeys = getValidApiKeys(env.GATEWAY_API_KEY);

    if (validApiKeys.some((validApiKey) => constantTimeEqual(validApiKey, presentedApiKey))) {
      // The key is valid on every gateway route, so origins must not receive it.
      const forwarded = new Request(request);
      forwarded.headers.delete("X-API-Key");
      return forwarded;
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
    await jose.jwtVerify(
      bearerMatch[1],
      getRemoteJwkSet(normalizedIssuer.jwksUrl),
      {
        issuer: normalizedIssuer.issuer,
        audience: auth0Audience,
        algorithms: ["RS256", "PS256"],
      },
    );
    return request;
  } catch {
    return new ErrorResponse("JWT verification failed", 401);
  }
};

apiKeyOrAuth0.optionsSchema = closed({});
