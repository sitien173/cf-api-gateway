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
  const logs: Array<{
    stage: string;
    outcome: string;
    status?: number;
    policyName?: string;
    query?: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  }> = [];
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
    new Request("https://gateway.example.com/api/test?key=abc&device=xyz", {
      headers: {
        "x-device-id": "device-123",
        "x-api-key": "secret-api-key",
        "x-license-key": "secret-license-key",
      },
    }),
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
          query: event.query,
          params: event.params,
          headers: event.headers,
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
  assert.equal(logs[0].query, "?key=abc&device=xyz");
  assert.deepEqual(logs[0].params, { key: "abc", device: "xyz" });
  assert.deepEqual(logs[0].headers, {
    "x-api-key": "[REDACTED]",
    "x-device-id": "device-123",
    "x-license-key": "[REDACTED]",
  });
  assert.deepEqual(
    logs.map((log) => [
      log.stage,
      log.outcome,
      log.status ?? null,
      log.policyName ?? null,
      log.query ?? null,
      JSON.stringify(log.params ?? {}),
      JSON.stringify(log.headers ?? {}),
    ]),
    [
      ["request_received", "received", null, null, "?key=abc&device=xyz", JSON.stringify({ key: "abc", device: "xyz" }), JSON.stringify({ "x-api-key": "[REDACTED]", "x-device-id": "device-123", "x-license-key": "[REDACTED]" })],
      ["route_resolution", "matched", null, null, "?key=abc&device=xyz", JSON.stringify({ key: "abc", device: "xyz" }), JSON.stringify({ "x-api-key": "[REDACTED]", "x-device-id": "device-123", "x-license-key": "[REDACTED]" })],
      ["request_policy", "short_circuit", 401, "stop", "?key=abc&device=xyz", JSON.stringify({ key: "abc", device: "xyz" }), JSON.stringify({ "x-api-key": "[REDACTED]", "x-device-id": "device-123", "x-license-key": "[REDACTED]" })],
      ["analytics", "scheduled", 401, null, "?key=abc&device=xyz", JSON.stringify({ key: "abc", device: "xyz" }), JSON.stringify({ "x-api-key": "[REDACTED]", "x-device-id": "device-123", "x-license-key": "[REDACTED]" })],
      ["response_finalization", "completed", 401, null, "?key=abc&device=xyz", JSON.stringify({ key: "abc", device: "xyz" }), JSON.stringify({ "x-api-key": "[REDACTED]", "x-device-id": "device-123", "x-license-key": "[REDACTED]" })],
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

test("executeGatewayRequest matches wildcard url routes as prefixes", async () => {
  const { ctx, flush } = createContext();
  const logs: Array<{ stage: string; outcome: string; routePath?: string; status?: number }> = [];

  const gateway = compileGateway(
    {
      policies: [],
      routes: [
        {
          path: "/udemy/v2/api/*",
          method: "GET",
          origin: {
            type: "url",
            options: { url: "https://origin.example.com" },
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
        url: async () => new Response("matched", { status: 200 }),
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/udemy/v2/api/sync"),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
    {
      logEvent: (event) => {
        logs.push({
          stage: event.stage,
          outcome: event.outcome,
          routePath: event.routePath,
          status: event.status,
        });
      },
    },
  );

  await flush();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "matched");
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.routePath ?? null, log.status ?? null]),
    [
      ["request_received", "received", null, null],
      ["route_resolution", "matched", "/udemy/v2/api/", null],
      ["origin", "started", "/udemy/v2/api/", null],
      ["origin", "completed", "/udemy/v2/api/", 200],
      ["response_finalization", "completed", null, 200],
    ],
  );
});

test("executeGatewayRequest handles CORS preflight without hitting origin", async () => {
  const { ctx, flush } = createContext();
  const logs: Array<{ stage: string; outcome: string; routePath?: string; status?: number }> = [];
  let originCalls = 0;

  const gateway = compileGateway(
    {
      policies: [
        {
          name: "cors-policy",
          type: "cors",
          options: {
            allowedOrigins: ["http://localhost:3000"],
            allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["x-admin-key"],
            allowCredentials: true,
          },
        },
      ],
      routes: [
        {
          path: "/udemy/v2/api/*",
          method: "GET",
          origin: {
            type: "url",
            options: { url: "https://origin.example.com" },
          },
          policies: {
            request: [],
            response: ["cors-policy"],
          },
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {
        cors: (response: Response, options: any) => {
          if (options.allowedOrigins.length > 0) {
            response.headers.set("Access-Control-Allow-Origin", options.allowedOrigins.join(", "));
          }
          if (options.allowedMethods.length > 0) {
            response.headers.set("Access-Control-Allow-Methods", options.allowedMethods.join(", "));
          }
          if (options.allowedHeaders.length > 0) {
            response.headers.set("Access-Control-Allow-Headers", options.allowedHeaders.join(", "));
          }
          if (options.allowCredentials) {
            response.headers.set("Access-Control-Allow-Credentials", `${options.allowCredentials}`);
          }
          return response;
        },
      },
      origins: {
        url: async () => {
          originCalls += 1;
          return new Response("origin", { status: 200 });
        },
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/udemy/v2/api/admin/verify", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-admin-key",
      },
    }),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
    {
      logEvent: (event) => {
        logs.push({
          stage: event.stage,
          outcome: event.outcome,
          routePath: event.routePath,
          status: event.status,
        });
      },
    },
  );

  await flush();

  assert.equal(originCalls, 0);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, PUT, DELETE, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "x-admin-key");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.routePath ?? null, log.status ?? null]),
    [
      ["request_received", "received", null, null],
      ["route_resolution", "matched", "/udemy/v2/api/", null],
      ["response_policy", "applied", "/udemy/v2/api/", 204],
      ["response_finalization", "completed", null, 204],
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
