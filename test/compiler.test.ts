import test from "node:test";
import assert from "node:assert/strict";
import { compileGateway } from "../src/gateway/compiler.ts";
import { cors } from "../src/policies/response/cors.ts";
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

test("parses nginx route modes, preserves raw paths, and orders routes", () => {
  const compiled = compileGateway(config({ routes: [
    { path: "~ ^/a/b", methods: ["GET"], origin: "main" },
    { path: "/a/b/c", methods: ["GET"], origin: "main" },
    { path: "^~ /a/", methods: ["GET"], origin: "main" },
    { path: "= /a", methods: ["GET"], origin: "main" },
    { path: "~* \\.PNG$", methods: ["GET"], origin: "main" },
    { path: "/a", methods: ["GET"], origin: "main" },
  ] }), handlers);
  assert.deepEqual(compiled.routes.map(({ path, pattern, matchMode, regex, order }) => ({ path, pattern, matchMode, regex: regex?.flags, order })), [
    { path: "= /a", pattern: "/a", matchMode: "exact", regex: undefined, order: 3 },
    { path: "/a/b/c", pattern: "/a/b/c", matchMode: "prefix", regex: undefined, order: 1 },
    { path: "^~ /a/", pattern: "/a/", matchMode: "prefixStop", regex: undefined, order: 2 },
    { path: "/a", pattern: "/a", matchMode: "prefix", regex: undefined, order: 5 },
    { path: "~ ^/a/b", pattern: "^/a/b", matchMode: "regex", regex: "", order: 0 },
    { path: "~* \\.PNG$", pattern: "\\.PNG$", matchMode: "regex", regex: "i", order: 4 }
  ]);
  assert.equal(compiled.routes.some(({ regex }) => regex?.global || regex?.sticky), false);
});

test("rejects invalid regex and duplicate nginx location keys but allows exact and prefix", () => {
  assert.throws(() => compileGateway(config({ routes: [{ path: "~ [", methods: ["GET"], origin: "main" }] }), handlers), /Route GET ~ \[: invalid regex/);
  assert.throws(() => compileGateway(config({ routes: [
    { path: "/x/", methods: ["GET"], origin: "main" },
    { path: "^~ /x/", methods: ["GET"], origin: "main" },
  ] }), handlers), /duplicate path and method/);
  assert.doesNotThrow(() => compileGateway(config({ routes: [
    { path: "= /x", methods: ["GET"], origin: "main" },
    { path: "/x", methods: ["GET"], origin: "main" },
  ] }), handlers));
});

test("proxyAll does not alter a route's configured match mode", () => {
  const compiled = compileGateway(config({
    origins: { main: { type: "proxyAll" } },
    routes: [{ path: "= /x", methods: ["GET"], origin: "main" }],
  }), { ...handlers, origins: { proxyAll: async () => new Response("ok") } });
  assert.equal(compiled.routes[0].matchMode, "exact");
});

test("rejects credentialed wildcard CORS policy", () => {
  assert.throws(() => compileGateway(config({ policies: { bad: { type: "cors", options: { allowedOrigins: ["*"], allowCredentials: true } } }, routes: [] }), { ...handlers, responsePolicies: { cors } }), /Policy bad: CORS cannot combine wildcard allowed origins with credentials/);
});

test("requires gateway auth when changeMethod turns a public route into a write", () => {
  const withChange = { ...handlers, requestPolicies: { ...handlers.requestPolicies, changeMethod: async (request: Request) => request } };
  const policies = { auth: { type: "apiKeyOrAuth0" }, "to-delete": { type: "changeMethod", options: { method: "delete" } } };
  assert.throws(() => compileGateway(config({ policies, routes: [{ path: "/x", methods: ["GET"], origin: "main", request: ["to-delete"] }] }), withChange), /Route GET \/x: must use an apiKeyOrAuth0 or basicAuth policy/);
  assert.doesNotThrow(() => compileGateway(config({ policies, routes: [{ path: "/x", methods: ["GET"], origin: "main", request: ["auth", "to-delete"] }] }), withChange));
});

test("requires the auth policy to run before body and method policies on write routes", () => {
  const withValidation = { ...handlers, requestPolicies: { ...handlers.requestPolicies, jsonBodyValidation: async (request: Request) => request } };
  const policies = { auth: { type: "apiKeyOrAuth0" }, body: { type: "jsonBodyValidation", options: { schema: {} } } };
  assert.throws(() => compileGateway(config({ policies, routes: [{ path: "/x", methods: ["POST"], origin: "main", request: ["body", "auth"] }] }), withValidation), /Route POST \/x: must run its auth policy before jsonBodyValidation and changeMethod/);
  assert.doesNotThrow(() => compileGateway(config({ policies, routes: [{ path: "/x", methods: ["POST"], origin: "main", request: ["auth", "body"] }] }), withValidation));
});

test("accepts basicAuth as gateway auth on write routes", () => {
  const withBasic = { ...handlers, requestPolicies: { basicAuth: async (request: Request) => request } };
  const compiled = compileGateway(config({ policies: { basic: { type: "basicAuth", options: { secret: "BASIC_AUTH_ADMIN" } } }, routes: [{ path: "/x", methods: ["POST"], origin: "main", request: ["basic"] }] }), withBasic);
  assert.deepEqual(compiled.routes.map(({ method }) => method), ["POST"]);
});
