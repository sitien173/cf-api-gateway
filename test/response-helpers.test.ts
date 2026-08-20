import test from "node:test";
import assert from "node:assert/strict";

import { ErrorResponse, JsonResponse } from "../src/helpers/response.ts";

test("JsonResponse retains caller headers and content type", async () => {
  const headers = new Headers({
    "Content-Type": "application/problem+json",
    "X-Request-Id": "request-123",
  });
  const response = new JsonResponse({ ok: true }, { headers, status: 202 });

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "application/problem+json");
  assert.equal(response.headers.get("x-request-id"), "request-123");
  assert.deepEqual(await response.json(), { ok: true });
});

test("JsonResponse supplies JSON content type when caller omits it", () => {
  const response = new ErrorResponse("bad request", 400);

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("content-type"), "application/json");
});
