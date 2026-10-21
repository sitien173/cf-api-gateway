import test from "node:test";
import assert from "node:assert/strict";
import { compileGateway } from "../src/gateway/compiler.ts";
import type { GatewayConfig, GatewayHandlers } from "../src/gateway/types.ts";

const handlers: GatewayHandlers = {
  requestPolicies: { apiKeyOrAuth0: async (request) => request },
  responsePolicies: { cors: async (response) => response },
  origins: { url: async () => new Response("ok") },
};
const config = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => ({
  origins: { main: { type: "url", options: { url: "https://origin.test" } } },
  policies: { auth: { type: "apiKeyOrAuth0" } },
  routes: [{ path: "/x", methods: ["GET", "POST"], origin: "main", request: ["auth"] }],
  ...overrides,
});

test("expands methods to separately compiled routes", () => {
  const compiled = compileGateway(config(), handlers);
  assert.deepEqual(compiled.routes.map(({ method }) => method), ["GET", "POST"]);
});

test("rejects unknown origins and policies with route context", () => {
  assert.throws(() => compileGateway(config({ routes: [{ path: "/x", methods: ["GET"], origin: "missing" }] }), handlers), /Route GET \/x: origin "missing" not found/);
  assert.throws(() => compileGateway(config({ routes: [{ path: "/x", methods: ["GET"], origin: "main", response: ["missing"] }] }), handlers), /Route GET \/x: Policy missing not found/);
});

test("rejects wrong-phase policies, duplicate method routes, and unauthenticated POST", () => {
  assert.throws(() => compileGateway(config({ policies: { cors: { type: "cors" } }, routes: [{ path: "/x", methods: ["GET"], origin: "main", request: ["cors"] }] }), handlers), /not found in this phase/);
  assert.throws(() => compileGateway(config({ routes: [{ path: "/x", methods: ["GET"], origin: "main" }, { path: "/x", methods: ["GET"], origin: "main" }] }), handlers), /duplicate path and method/);
  assert.throws(() => compileGateway(config({ routes: [{ path: "/x", methods: ["POST"], origin: "main" }] }), handlers), /apiKeyOrAuth0/);
});

test("allows unauthenticated POST when route opts out with auth none", () => {
  const compiled = compileGateway(config({ routes: [{ path: "/x", methods: ["POST"], origin: "main", auth: "none" }] }), handlers);
  assert.deepEqual(compiled.routes.map(({ method }) => method), ["POST"]);
});

test("rejects credentialed wildcard CORS policy", () => {
  assert.throws(() => compileGateway(config({ policies: { bad: { type: "cors", options: { allowedOrigins: ["*"], allowCredentials: true } } }, routes: [] }), handlers), /CORS policy bad cannot combine wildcard allowed origins with credentials/);
});
