import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import * as jose from "jose";

import { compileGateway, executeGatewayRequest } from "../src/gateway/index.ts";
import * as requestPolicies from "../src/policies/request/index.ts";
import { apiKeyOrAuth0 } from "../src/policies/request/auth0-jwt.ts";

const issuer = "https://tenant.example.com/";
const audience = "https://api.example.com";
const nodeRequire = createRequire(import.meta.url);
const https = nodeRequire("https") as typeof import("node:https");

const createTokenFixture = async (tokenIssuer = issuer) => {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
  const kid = "test-key";
  const jwk = await jose.exportJWK(publicKey);
  const token = await new jose.SignJWT({ sub: "user-123" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(tokenIssuer)
    .setAudience(audience)
    .setExpirationTime("1h")
    .sign(privateKey);

  return {
    token,
    publicKey,
    jwks: { keys: [{ ...jwk, alg: "RS256", kid, use: "sig" }] },
  };
};

const createContext = () => ({
  waitUntil() {},
  passThroughOnException() {},
} as ExecutionContext);

const withMockedJwks = async <T>(
  jwks: { keys: jose.JWK[] },
  run: (resolverCalls: () => number) => Promise<T>,
): Promise<T> => {
  const originalGet = https.get;
  let resolverCalls = 0;
  https.get = (() => {
    resolverCalls += 1;
    const request = new EventEmitter() as import("node:http").ClientRequest;
    request.destroy = () => request;
    setImmediate(() => {
      const response = Readable.from([Buffer.from(JSON.stringify(jwks))]) as import("node:http").IncomingMessage;
      response.statusCode = 200;
      request.emit("response", response);
    });
    return request;
  }) as typeof https.get;

  try {
    return await run(() => resolverCalls);
  } finally {
    https.get = originalGet;
  }
};

test("apiKeyOrAuth0 accepts a trimmed API key without Auth0 configuration", async () => {
  const request = new Request("https://gateway.example.com/orders", {
    headers: { "X-API-Key": "  valid-key  " },
  });

  const response = await apiKeyOrAuth0(
    request,
    {},
    { GATEWAY_API_KEY: " , valid-key,another-key " },
  );

  assert.equal(response, request);
});

test("apiKeyOrAuth0 rejects an invalid API key without falling back to JWT", async () => {
  const validIssuer = "https://api-key-tenant.example.com/";
  const fixture = await createTokenFixture(validIssuer);

  await withMockedJwks(fixture.jwks, async (resolverCalls) => {
    const response = await apiKeyOrAuth0(
      new Request("https://gateway.example.com/orders", {
        headers: {
          "X-API-Key": "invalid-key",
          authorization: `Bearer ${fixture.token}`,
        },
      }),
      {},
      {
        AUTH0_ISSUER: validIssuer,
        AUTH0_AUDIENCE: audience,
        GATEWAY_API_KEY: "valid-key",
      },
    );

    assert.equal(response.status, 401);
    assert.equal(resolverCalls(), 0);
  });
});

test("apiKeyOrAuth0 returns 500 when Auth0 bindings are missing", async () => {
  const response = await apiKeyOrAuth0(
    new Request("https://gateway.example.com/orders", {
      headers: { authorization: "Bearer token" },
    }),
    {},
    {},
  );

  assert.equal(response.status, 500);
});

test("apiKeyOrAuth0 rejects HTTP issuer configuration", async () => {
  const response = await apiKeyOrAuth0(
    new Request("https://gateway.example.com/orders", {
      headers: { authorization: "Bearer token" },
    }),
    {},
    { AUTH0_ISSUER: "http://tenant.example.com/", AUTH0_AUDIENCE: audience },
  );

  assert.equal(response.status, 500);
});

test("apiKeyOrAuth0 returns 401 for missing and invalid bearer tokens", async () => {
  const env = { AUTH0_ISSUER: issuer, AUTH0_AUDIENCE: audience };

  const missing = await apiKeyOrAuth0(new Request("https://gateway.example.com/orders"), {}, env);
  const invalid = await apiKeyOrAuth0(
    new Request("https://gateway.example.com/orders", {
      headers: { authorization: "Bearer invalid-token" },
    }),
    {},
    env,
  );

  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
});

test("apiKeyOrAuth0 caches JWK resolvers by normalized JWKS URL", async () => {
  const cacheIssuer = "https://cache-tenant.example.com/";
  const fixture = await createTokenFixture(cacheIssuer);
  await withMockedJwks(fixture.jwks, async (resolverCalls) => {
    const first = await apiKeyOrAuth0(
      new Request("https://gateway.example.com/orders", {
        headers: { authorization: `Bearer ${fixture.token}` },
      }),
      {},
      { AUTH0_ISSUER: cacheIssuer.slice(0, -1), AUTH0_AUDIENCE: audience },
    );
    assert.equal(resolverCalls(), 1);
    const second = await apiKeyOrAuth0(
      new Request("https://gateway.example.com/orders", {
        headers: { authorization: `Bearer ${fixture.token}` },
      }),
      {},
      { AUTH0_ISSUER: cacheIssuer, AUTH0_AUDIENCE: audience },
    );

    assert.equal(first instanceof Request, true);
    assert.equal(second instanceof Request, true);
    assert.equal((first as Request & { user?: string }).user, "user-123");
    assert.equal(resolverCalls(), 1);
  });
});

test("request policies receive the Worker environment", async () => {
  let receivedEnv: unknown;
  const gateway = compileGateway(
    {
      policies: [{ name: "capture", type: "capture" }],
      routes: [{
        path: "/public",
        method: "GET",
        origin: { type: "url", options: {} },
        policies: { request: ["capture"], response: [] },
      }],
    },
    {
      requestPolicies: {
        capture: async (request, _options, env) => {
          receivedEnv = env;
          return request;
        },
      },
      responsePolicies: {},
      origins: { url: async () => new Response("ok") },
    },
  );
  const env = { AUTH0_ISSUER: issuer, AUTH0_AUDIENCE: audience };

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/public"),
    env,
    createContext(),
  );

  assert.equal(response.status, 200);
  assert.equal(receivedEnv, env);
});

test("unsafe routes require a policy configured with type apiKeyOrAuth0", () => {
  const route = (method: string, request: string[] = []) => ({
    path: "/api/resource",
    method,
    origin: { type: "url", options: {} },
    policies: { request, response: [] },
  });
  const handlers = {
    requestPolicies: { namedAuth: async (request: Request) => request },
    responsePolicies: {},
    origins: { url: async () => new Response("ok") },
  };

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.throws(
      () => compileGateway({
        policies: [{ name: "named-auth", type: "namedAuth" }],
        routes: [route(method, ["named-auth"])],
      }, handlers),
      /apiKeyOrAuth0/,
    );
  }

  assert.doesNotThrow(() => compileGateway({
    policies: [{ name: "jwt-policy", type: "apiKeyOrAuth0" }],
    routes: [route("POST", ["jwt-policy"])],
  }, {
    ...handlers,
    requestPolicies: { apiKeyOrAuth0: handlers.requestPolicies.namedAuth },
  }));
  assert.doesNotThrow(() => compileGateway({ policies: [], routes: [route("GET"), route("OPTIONS")] }, handlers));
});

test("apiKeyOrAuth0 uses the production request-policy barrel", async () => {
  let originCalls = 0;
  const gateway = compileGateway(
    {
      policies: [{ name: "require-api-key-or-auth0", type: "apiKeyOrAuth0" }],
      routes: [{
        path: "/api/resource",
        method: "POST",
        origin: { type: "url", options: {} },
        policies: { request: ["require-api-key-or-auth0"], response: [] },
      }],
    },
    {
      requestPolicies,
      responsePolicies: {},
      origins: {
        url: async () => {
          originCalls += 1;
          return new Response("ok");
        },
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api/resource", {
      method: "POST",
      headers: { "X-API-Key": "client-key" },
    }),
    { GATEWAY_API_KEY: "client-key" },
    createContext(),
  );

  assert.equal(response.status, 200);
  assert.equal(originCalls, 1);
});

test("valid Auth0 tokens reach mutation origins while OPTIONS stays public", async () => {
  const validIssuer = "https://valid-tenant.example.com/";
  const fixture = await createTokenFixture(validIssuer);
  let originCalls = 0;

  await withMockedJwks(fixture.jwks, async () => {
    const gateway = compileGateway(
      {
        policies: [{ name: "require-auth", type: "apiKeyOrAuth0" }],
        routes: [
          {
            path: "/api/resource",
            method: "POST",
            origin: { type: "url", options: {} },
            policies: { request: ["require-auth"], response: [] },
          },
          {
            path: "/api/resource",
            method: "GET",
            origin: { type: "url", options: {} },
            policies: { request: [], response: [] },
          },
        ],
      },
      {
        requestPolicies: { apiKeyOrAuth0 },
        responsePolicies: {},
        origins: { url: async () => {
          originCalls += 1;
          return new Response("ok", { status: 200 });
        } },
      },
    );
    const env = {
      AUTH0_ISSUER: validIssuer,
      AUTH0_AUDIENCE: audience,
    };

    const unauthenticated = await executeGatewayRequest(
      gateway,
      new Request("https://gateway.example.com/api/resource", { method: "POST" }),
      env,
      createContext(),
    );
    const authenticated = await executeGatewayRequest(
      gateway,
      new Request("https://gateway.example.com/api/resource", {
        method: "POST",
        headers: { authorization: `Bearer ${fixture.token}` },
      }),
      env,
      createContext(),
    );
    const preflight = await executeGatewayRequest(
      gateway,
      new Request("https://gateway.example.com/api/resource", {
        method: "OPTIONS",
        headers: { "access-control-request-method": "POST" },
      }),
      env,
      createContext(),
    );

    assert.equal(unauthenticated.status, 401);
    assert.equal(authenticated.status, 200);
    assert.equal(preflight.status, 204);
    assert.equal(originCalls, 1);
  });
});
