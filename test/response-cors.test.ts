import test from "node:test";
import assert from "node:assert/strict";

import { cors } from "../src/policies/response/cors.ts";
import { compileGateway } from "../src/gateway/compiler.ts";

test("cors response policy tolerates omitted optional fields", () => {
  const response = new Response("ok");
  const request = new Request("https://cf-api-gateway.example.com/udemy/api/courses", {
    headers: {
      origin: "https://www.udemy.com",
    },
  });

  assert.doesNotThrow(() =>
    cors(response, {
      allowedOrigins: ["*.udemy.com"],
      allowedMethods: ["GET", "POST"],
      allowedHeaders: ["*"],
      allowCredentials: true,
    }, request),
  );

  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://www.udemy.com",
  );
  assert.equal(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, POST",
  );
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "*");
  assert.equal(
    response.headers.get("Access-Control-Allow-Credentials"),
    "true",
  );
  assert.equal(response.headers.has("Access-Control-Expose-Headers"), false);
  assert.equal(response.headers.has("Access-Control-Max-Age"), false);
});

test("compileGateway rejects credentialed wildcard CORS policies", () => {
  assert.throws(
    () =>
      compileGateway(
        {
          origins: {
            origin: {
              type: "url",
              options: { url: "https://origin.example.com" },
            },
          },
          policies: {
            "unsafe-cors": {
              type: "cors",
              options: {
                allowedOrigins: ["*"],
                allowedMethods: ["GET"],
                allowedHeaders: ["*"],
                allowCredentials: true,
              },
            },
          },
          routes: [
            {
              path: "/health",
              methods: ["GET"],
              origin: "origin",
              request: [],
              response: ["unsafe-cors"],
            },
          ],
        },
        {
          requestPolicies: {},
          responsePolicies: { cors },
          origins: { url: async () => new Response("ok") },
        },
      ),
    /cannot combine wildcard allowed origins with credentials/,
  );
});

test("cors response policy echoes requested headers for credentialed wildcard headers", () => {
  const response = new Response("ok");
  const request = new Request("https://cf-api-gateway.example.com/", {
    headers: {
      origin: "https://www.udemy.com",
      "access-control-request-headers": "x-admin-key, authorization",
    },
  });

  cors(
    response,
    {
      allowedOrigins: ["https://www.udemy.com"],
      allowedMethods: ["GET"],
      allowedHeaders: ["*"],
      allowCredentials: true,
    },
    request,
  );

  assert.equal(
    response.headers.get("Access-Control-Allow-Headers"),
    "x-admin-key, authorization",
  );
});

test("cors response policy varies on Origin when the origin does not match", () => {
  const response = new Response("ok");
  const request = new Request("https://cf-api-gateway.example.com/", {
    headers: {
      origin: "https://evil.example.com",
    },
  });

  cors(
    response,
    {
      allowedOrigins: ["https://allowed.example.com"],
      allowedMethods: [],
      allowedHeaders: [],
      allowCredentials: false,
    },
    request,
  );

  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Vary"), "Origin");
});
