import test from "node:test";
import assert from "node:assert/strict";

import { cors } from "../src/policies/response/cors.ts";

test("cors response policy echoes the request origin for matching wildcard hosts", () => {
  const response = new Response("ok");
  const request = new Request("https://cf-api-gateway.example.com/udemy/v2/api/admin/verify", {
    headers: {
      origin: "https://udemy-v2.hcmc.online",
    },
  });

  cors(
    response,
    {
      allowedOrigins: ["*.hcmc.online"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["*"],
      allowCredentials: true,
    },
    request,
  );

  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://udemy-v2.hcmc.online",
  );
});

test("cors response policy rejects insecure wildcard origins", () => {
  const response = new Response("ok");
  const request = new Request("https://cf-api-gateway.example.com/udemy/v2/api/admin/verify", {
    headers: {
      origin: "http://evil.udemy.com",
    },
  });

  cors(
    response,
    {
      allowedOrigins: ["*.udemy.com"],
      allowedMethods: ["GET"],
      allowedHeaders: [],
      allowCredentials: true,
    },
    request,
  );

  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("cors response policy preserves wildcard localhost development origins", () => {
  const cases = [
    { allowedOrigin: "*.localhost", origin: "http://localhost" },
    { allowedOrigin: "*.127.0.0.1", origin: "http://127.0.0.1" },
  ];

  for (const { allowedOrigin, origin } of cases) {
    const response = new Response("ok");
    const request = new Request("https://cf-api-gateway.example.com/", {
      headers: { origin },
    });

    cors(
      response,
      {
        allowedOrigins: [allowedOrigin],
        allowedMethods: [],
        allowedHeaders: [],
        allowCredentials: true,
      },
      request,
    );

    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  }
});
