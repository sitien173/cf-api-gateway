import test from "node:test";
import assert from "node:assert/strict";

import { cors } from "../src/policies/response/cors.ts";

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
    } as any, request),
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
