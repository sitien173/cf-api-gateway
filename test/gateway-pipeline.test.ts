import test from "node:test";
import assert from "node:assert/strict";

import {
  compileGateway,
  executeGatewayRequest,
} from "../src/gateway/index.ts";

const createContext = () => {
  const promises: Promise<unknown>[] = [];

  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        promises.push(Promise.resolve(promise));
      },
      passThroughOnException() {},
    } as ExecutionContext,
    async flush() {
      await Promise.all(promises);
    },
  };
};

test("compileGateway resolves handlers and rejects unknown policy references", () => {
  const handlers = {
    requestPolicies: {
      auth: async (request: Request) => request,
    },
    responsePolicies: {},
    origins: {
      url: async () => new Response("ok"),
    },
  };

  const validConfig = {
    policies: [
      {
        name: "auth-policy",
        type: "auth",
        options: { role: "user" },
      },
    ],
    routes: [
      {
        path: "/api/test",
        method: "GET",
        origin: {
          type: "url",
          options: { url: "https://example.com" },
        },
        policies: {
          request: ["auth-policy"],
          response: [],
        },
      },
    ],
  };

  const gateway = compileGateway(validConfig, handlers);

  assert.equal(gateway.routes.length, 1);
  assert.equal(gateway.routes[0].requestPolicies.length, 1);

  assert.throws(
    () =>
      compileGateway(
        {
          ...validConfig,
          routes: [
            {
              ...validConfig.routes[0],
              policies: {
                request: ["missing-policy"],
                response: [],
              },
            },
          ],
        },
        handlers,
      ),
    /Policy missing-policy not found/,
  );
});

test("executeGatewayRequest short-circuits when a request policy returns a response", async () => {
  let originCalls = 0;
  const analytics: Array<{ path: string; status: number; latency: number }> = [];
  const logs: Array<{ stage: string; outcome: string; status?: number; policyName?: string }> = [];
  const { ctx, flush } = createContext();

  const gateway = compileGateway(
    {
      policies: [
        {
          name: "stop",
          type: "stop",
          options: { status: 401 },
        },
      ],
      routes: [
        {
          path: "/api/test",
          method: "GET",
          origin: {
            type: "url",
            options: { url: "https://example.com" },
          },
          policies: {
            request: ["stop"],
            response: [],
          },
        },
      ],
    },
    {
      requestPolicies: {
        stop: async (_request: Request, options: { status: number }) =>
          new Response("blocked", { status: options.status }),
      },
      responsePolicies: {},
      origins: {
        url: async () => {
          originCalls += 1;
          return new Response("origin");
        },
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api/test"),
    { ANALYTICS_ENABLED: "true", GATEWAY_NAME: "test-gateway" },
    ctx,
    {
      now: () => 100,
      logEvent: (event) => {
        logs.push({
          stage: event.stage,
          outcome: event.outcome,
          status: event.status,
          policyName: event.policyName,
        });
      },
      logAnalytics: async (request, finalResponse, _env, latency) => {
        analytics.push({
          path: new URL(request.url).pathname,
          status: finalResponse.status,
          latency,
        });
      },
    },
  );

  await flush();

  assert.equal(originCalls, 0);
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "blocked");
  assert.deepEqual(analytics, [{ path: "/api/test", status: 401, latency: 0 }]);
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.status ?? null, log.policyName ?? null]),
    [
      ["request_received", "received", null, null],
      ["route_resolution", "matched", null, null],
      ["request_policy", "short_circuit", 401, "stop"],
      ["analytics", "scheduled", 401, null],
      ["response_finalization", "completed", 401, null],
    ],
  );
});

test("executeGatewayRequest invokes origin and response policies for a matched route", async () => {
  const { ctx, flush } = createContext();
  const logs: Array<{ stage: string; outcome: string; status?: number; policyName?: string }> = [];
  const gateway = compileGateway(
    {
      policies: [
        {
          name: "pass-through",
          type: "passThrough",
        },
        {
          name: "tag",
          type: "tag",
          options: { header: "x-gateway", value: "edge" },
        },
      ],
      routes: [
        {
          path: "/proxy/",
          method: "GET",
          origin: {
            type: "proxyAll",
            options: {},
          },
          policies: {
            request: ["pass-through"],
            response: ["tag"],
          },
        },
      ],
    },
    {
      requestPolicies: {
        passThrough: async (request: Request) => request,
      },
      responsePolicies: {
        tag: (response: Response, options: { header: string; value: string }) => {
          response.headers.set(options.header, options.value);
        },
      },
      origins: {
        proxyAll: async () => new Response("origin-ok", { status: 200 }),
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/proxy/orders"),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
    {
      logEvent: (event) => {
        logs.push({
          stage: event.stage,
          outcome: event.outcome,
          status: event.status,
          policyName: event.policyName,
        });
      },
    },
  );

  await flush();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "origin-ok");
  assert.equal(response.headers.get("x-gateway"), "edge");
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.status ?? null, log.policyName ?? null]),
    [
      ["request_received", "received", null, null],
      ["route_resolution", "matched", null, null],
      ["request_policy", "continued", null, "pass-through"],
      ["origin", "started", null, null],
      ["origin", "completed", 200, null],
      ["response_policy", "applied", 200, "tag"],
      ["response_finalization", "completed", 200, null],
    ],
  );
});

test("executeGatewayRequest finalizes route misses as 404 responses", async () => {
  const analytics: number[] = [];
  const logs: Array<{ stage: string; outcome: string; status?: number }> = [];
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      policies: [],
      routes: [],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: {},
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/missing"),
    { ANALYTICS_ENABLED: "true", GATEWAY_NAME: "test-gateway" },
    ctx,
    {
      logEvent: (event) => {
        logs.push({
          stage: event.stage,
          outcome: event.outcome,
          status: event.status,
        });
      },
      logAnalytics: async (_request, finalResponse) => {
        analytics.push(finalResponse.status);
      },
    },
  );

  await flush();

  assert.equal(response.status, 404);
  assert.equal(analytics[0], 404);
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.status ?? null]),
    [
      ["request_received", "received", null],
      ["route_resolution", "route_miss", 404],
      ["analytics", "scheduled", 404],
      ["response_finalization", "completed", 404],
    ],
  );
});

test("executeGatewayRequest finalizes unexpected failures as 500 responses", async () => {
  const analytics: number[] = [];
  const logs: Array<{ stage: string; outcome: string; status?: number; errorMessage?: string }> = [];
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      policies: [],
      routes: [
        {
          path: "/api/fail",
          method: "GET",
          origin: {
            type: "url",
            options: {},
          },
          policies: {
            request: [],
            response: [],
          },
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: {
        url: async () => {
          throw new Error("boom");
        },
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api/fail"),
    { ANALYTICS_ENABLED: "true", GATEWAY_NAME: "test-gateway" },
    ctx,
    {
      logEvent: (event) => {
        logs.push({
          stage: event.stage,
          outcome: event.outcome,
          status: event.status,
          errorMessage: event.errorMessage,
        });
      },
      logAnalytics: async (_request, finalResponse) => {
        analytics.push(finalResponse.status);
      },
    },
  );

  await flush();

  assert.equal(response.status, 500);
  assert.equal(analytics[0], 500);
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.status ?? null, log.errorMessage ?? null]),
    [
      ["request_received", "received", null, null],
      ["route_resolution", "matched", null, null],
      ["origin", "started", null, null],
      ["execution", "failed", 500, "boom"],
      ["analytics", "scheduled", 500, null],
      ["response_finalization", "completed", 500, null],
    ],
  );
});
