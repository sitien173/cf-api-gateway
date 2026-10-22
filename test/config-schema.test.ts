import test from "node:test";
import assert from "node:assert/strict";

import config from "../src/config.json";
import { validateGatewayConfig } from "../src/config/schema.ts";
import { compileGateway } from "../src/gateway/compiler.ts";
import * as requestPolicies from "../src/policies/request/index.ts";
import * as responsePolicies from "../src/policies/response/index.ts";
import * as origins from "../src/origins/index.ts";

test("accepts the current gateway configuration", () => {
  const result = validateGatewayConfig(config);

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.config.routes.length, config.routes.length);
    assert.equal(
      Object.keys(result.config.policies).length,
      Object.keys(config.policies).length,
    );
  }
});

test("bundled config compiles with migrated routes", () => {
  const result = validateGatewayConfig(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const gateway = compileGateway(result.config, { requestPolicies, responsePolicies, origins });
  const route = (method: string, path: string) => gateway.routes.find((candidate) =>
    candidate.method === method && (candidate.matchMode === "exact"
      ? candidate.pattern === path
      : candidate.matchMode === "regex"
        ? candidate.regex?.test(path)
        : path.startsWith(candidate.pattern)),
  );
  assert.equal(route("GET", "/vault")?.path, "~ ^/vault(/|$)");
  assert.equal(route("POST", "/vault/api/x")?.path, "~ ^/vault(/|$)");
  assert.equal(route("GET", "/sonarqube")?.path, "~ ^/sonarqube(/|$)");
  assert.equal(route("GET", "/udemy/v3/api/x")?.path, "/udemy/v3/api/");
  assert.notEqual(route("GET", "/vaultx")?.path, "~ ^/vault(/|$)");
});

test("rejects a document missing routes", () => {
  const { routes: _routes, ...withoutRoutes } = config;
  const result = validateGatewayConfig(withoutRoutes);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.length > 0);
  }
});

test("rejects a route whose request policies are not an array", () => {
  const value = {
    ...config,
    routes: [
      {
        ...config.routes[0],
        request: "require-auth0",
      },
    ],
  };
  const result = validateGatewayConfig(value);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.length > 0);
  }
});

test("rejects v1 shape and unknown keys at every object level", () => {
  assert.equal(validateGatewayConfig({ routes: [], policies: [] }).valid, false);
  const cases = [
    { ...config, extra: true },
    { ...config, origins: { ...config.origins, "udemy-v3": { ...config.origins["udemy-v3"], extra: true } } },
    { ...config, policies: { ...config.policies, "udemy-cors": { ...config.policies["udemy-cors"], extra: true } } },
    { ...config, routes: [{ ...config.routes[0], extra: true }] },
    { ...config, origins: { ...config.origins, "udemy-v3": { ...config.origins["udemy-v3"], options: { ...config.origins["udemy-v3"].options, extra: true } } } },
  ];
  for (const value of cases) assert.equal(validateGatewayConfig(value).valid, false);
});

test("rejects invalid methods and malformed type-specific options", () => {
  const baseRoute = config.routes[0];
  for (const methods of [[], ["GET", "GET"], ["CONNECT"]]) {
    assert.equal(validateGatewayConfig({ ...config, routes: [{ ...baseRoute, methods }] }).valid, false);
  }
  assert.equal(validateGatewayConfig({ ...config, policies: { cors: { type: "cors", options: { allowedMethods: [], allowedHeaders: [], allowCredentials: false } } } }).valid, false);
  assert.equal(validateGatewayConfig({ ...config, origins: { broken: { type: "url", options: {} } } }).valid, false);
  assert.equal(validateGatewayConfig({ ...config, routes: [{ ...baseRoute, auth: "none" }] }).valid, true);
  assert.equal(validateGatewayConfig({ ...config, routes: [{ ...baseRoute, auth: "optional" }] }).valid, false);
});

test("derives policy options from handler schemas", () => {
  const withPolicy = (policy: Record<string, unknown>) =>
    validateGatewayConfig({ ...config, policies: { ...config.policies, basic: policy } }).valid;
  assert.equal(withPolicy({ type: "basicAuth", options: { secret: "BASIC_AUTH_ADMIN" } }), true);
  assert.equal(withPolicy({ type: "basicAuth", options: { username: "alice", password: "secret" } }), false);
  assert.equal(withPolicy({ type: "basicAuth", options: { secret: "basic-auth" } }), false);
  assert.equal(withPolicy({ type: "apiKeyOrAuth0" }), true);
  assert.equal(withPolicy({ type: "changeMethod" }), false);
  assert.equal(
    validateGatewayConfig({ ...config, origins: { ...config.origins, legacy: { type: "proxyAll", options: { primaryUrl: "https://a.test", fallbackUrl: "https://b.test" } } } }).valid,
    true,
  );
});

test("rejects unsupported and wildcard route path forms", () => {
  const baseRoute = config.routes[0];
  for (const path of ["@x", "/x/*", "= /*", "^~ /*", "/*", "=/x", "~"]) {
    assert.equal(validateGatewayConfig({ ...config, routes: [{ ...baseRoute, path }] }).valid, false, path);
  }
});

test("rejects a route missing origin.type", () => {
  const { type: _type, ...originWithoutType } = config.origins["udemy-v3"];
  const value = {
    ...config,
    origins: { ...config.origins, "udemy-v3": originWithoutType },
  };
  const result = validateGatewayConfig(value);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((error) => error.keyword === "required"));
  }
});
