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
