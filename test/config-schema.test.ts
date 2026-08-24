import test from "node:test";
import assert from "node:assert/strict";

import config from "../src/config.json";
import { validateGatewayConfig } from "../src/config/schema.ts";

test("accepts the current gateway configuration", () => {
  const result = validateGatewayConfig(config);

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.config.routes.length, config.routes.length);
    assert.equal(result.config.policies.length, config.policies.length);
  }
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
        policies: {
          ...config.routes[0].policies,
          request: "require-auth0",
        },
      },
    ],
  };
  const result = validateGatewayConfig(value);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.length > 0);
  }
});

test("rejects a route missing origin.type", () => {
  const value = {
    ...config,
    routes: [
      {
        ...config.routes[0],
        origin: {
          ...config.routes[0].origin,
          type: undefined,
        },
      },
    ],
  };
  const result = validateGatewayConfig(value);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.length > 0);
  }
});
