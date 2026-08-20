import test from "node:test";
import assert from "node:assert/strict";

import { compileGateway, executeGatewayRequest } from "../src/gateway/index.ts";
import { logAnalytics } from "../src/services/analytics.ts";
type AnalyticsEngineDataPoint = {
  indexes?: (ArrayBuffer | string | null)[];
  blobs?: (ArrayBuffer | string | null)[];
  doubles?: number[];
};

const createDataset = () => {
  const points: AnalyticsEngineDataPoint[] = [];

  return {
    points,
    writeDataPoint(point: AnalyticsEngineDataPoint) {
      points.push(point);
    },
  };
};

test("logAnalytics writes the documented Analytics Engine datapoint layout", async () => {
  const dataset = createDataset();

  await logAnalytics(
    {
      routePath: "/api/orders",
      method: "POST",
      status: 201,
      latencyMs: 42,
    },
    {
      GATEWAY_NAME: "test-gateway",
      ANALYTICS_ENABLED: "true",
      API_ANALYTICS: dataset,
    },
  );

  assert.deepEqual(dataset.points, [
    {
      indexes: ["test-gateway"],
      blobs: ["/api/orders", "POST"],
      doubles: [201, 42],
    },
  ]);
});

test("each gateway response creates one datapoint and route misses use a fixed label", async () => {
  const dataset = createDataset();
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
  } as ExecutionContext;
  const env = {
    GATEWAY_NAME: "test-gateway",
    ANALYTICS_ENABLED: "true",
    API_ANALYTICS: dataset,
  };
  const gateway = compileGateway(
    {
      policies: [],
      routes: [
        {
          path: "/api/orders",
          method: "GET",
          origin: { type: "url", options: {} },
          policies: { request: [], response: [] },
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: { url: async () => new Response("ok", { status: 200 }) },
    },
  );

  await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api/orders"),
    env,
    ctx,
    { logAnalytics },
  );
  await executeGatewayRequest(
    compileGateway({ policies: [], routes: [] }, {
      requestPolicies: {},
      responsePolicies: {},
      origins: {},
    }),
    new Request("https://gateway.example.com/missing"),
    env,
    ctx,
    { logAnalytics },
  );
  await Promise.all(pending);

  assert.equal(dataset.points.length, 2);
  assert.deepEqual(dataset.points.map((point) => point.indexes), [
    ["test-gateway"],
    ["test-gateway"],
  ]);
  assert.deepEqual(dataset.points.map((point) => point.blobs), [
    ["/api/orders", "GET"],
    ["route_miss", "GET"],
  ]);
  assert.deepEqual(dataset.points.map((point) => point.doubles?.[0]), [200, 404]);
});
