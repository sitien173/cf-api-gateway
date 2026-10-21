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

const createResponseGateway = () =>
  compileGateway(
    {
      origins: { orders: { type: "url", options: { url: "https://origin.test" } } },
      policies: {},
      routes: [{ path: "/api/orders", methods: ["GET"], origin: "orders" }],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: { url: async () => new Response("ok", { status: 200 }) },
    },
  );

type BackgroundContext = {
  ctx: ExecutionContext;
  pending: Promise<unknown>[];
};

const createBackgroundContext = (): BackgroundContext => {
  const pending: Promise<unknown>[] = [];

  return {
    pending,
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
    } as ExecutionContext,
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
  const gateway = createResponseGateway();

  await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api/orders"),
    env,
    ctx,
    { logAnalytics },
  );
  await executeGatewayRequest(
    compileGateway({ origins: {}, policies: {}, routes: [] }, {
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

test("analytics failures stay in the background and preserve the response", async () => {
  const failures = [
    {
      name: "synchronous throw",
      createLogger: (datapoints: unknown[]) => (_event: unknown, _env: unknown) => {
        datapoints.push(_event);
        throw new Error("sync analytics failure");
      },
    },
    {
      name: "rejected promise",
      createLogger: (datapoints: unknown[]) => async (_event: unknown, _env: unknown) => {
        datapoints.push(_event);
        throw new Error("async analytics failure");
      },
    },
  ];

  for (const failure of failures) {
    const datapoints: unknown[] = [];
    const { ctx, pending } = createBackgroundContext();
    const logs: { stage: string; outcome: string }[] = [];

    const response = await executeGatewayRequest(
      createResponseGateway(),
      new Request("https://gateway.example.com/api/orders"),
      {},
      ctx,
      {
        logAnalytics: failure.createLogger(datapoints),
        logEvent: (event) => logs.push({ stage: event.stage, outcome: event.outcome }),
      },
    );

    assert.equal(response.status, 200, failure.name);
    const results = await Promise.allSettled(pending);
    assert.equal(results.length, 1, failure.name);
    assert.equal(results[0].status, "rejected", failure.name);
    assert.equal(datapoints.length, 1, failure.name);
    assert.equal(logs.some((log) => log.stage === "execution"), false, failure.name);
  }
});
