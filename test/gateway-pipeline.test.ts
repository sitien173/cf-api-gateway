import test from "node:test";
import assert from "node:assert/strict";

import { executeUnavailableRequest } from "../src/index.ts";
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
    origins: {
      url: { type: "url", options: { url: "https://example.com" } },
    },
    policies: {
      "auth-policy": {
        type: "auth",
        options: { role: "user" },
      },
    },
    routes: [
      {
        path: "/api/test",
        methods: ["GET"],
        origin: "url",
        request: ["auth-policy"],
        response: [],
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
              request: ["missing-policy"],
            },
          ],
        },
        handlers,
      ),
    /Policy missing-policy not found/,
  );
});

test("compileGateway normalizes route methods and rejects unknown methods", () => {
  const handlers = {
    requestPolicies: {},
    responsePolicies: {},
    origins: {
      url: async () => new Response("ok"),
    },
  };
  const route = {
    path: "/health",
    methods: ["get"],
    origin: "health",
    request: [],
    response: [],
  };
  const config = {
    origins: { health: { type: "url", options: { url: "https://origin.example.com" } } },
    policies: {},
    routes: [route],
  };

  const gateway = compileGateway(config, handlers);
  assert.equal(gateway.routes[0].method, "GET");

  assert.throws(
    () => compileGateway({ ...config, routes: [{ ...route, methods: ["INVALID"] }] }, handlers),
    /Unknown HTTP method INVALID/,
  );
});

test("executeGatewayRequest short-circuits when a request policy returns a response", async () => {
  let originCalls = 0;
  const analytics: Array<{ path: string; status: number; latency: number }> = [];
  const logs: Array<Record<string, unknown>> = [];
  const { ctx, flush } = createContext();

  const gateway = compileGateway(
    {
      origins: {
        url: { type: "url", options: { url: "https://example.com" } },
      },
      policies: {
        stop: {
          type: "stop",
          options: { status: 401 },
        },
      },
      routes: [
        {
          path: "/api/test",
          methods: ["GET"],
          origin: "url",
          request: ["stop"],
          response: [],
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
        logs.push(event);
      },
      logAnalytics: async (event) => {
        analytics.push({
          path: event.routePath,
          status: event.status,
          latency: event.latencyMs,
        });
      },
    },
  );

  await flush();

  assert.equal(originCalls, 0);
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "blocked");
  assert.deepEqual(analytics, [{ path: "/api/test", status: 401, latency: 0 }]);
  for (const log of logs) {
    assert.equal("path" in log, false);
    assert.equal("query" in log, false);
    assert.equal("params" in log, false);
    assert.equal("headers" in log, false);
    assert.equal("targetUrl" in log, false);
    assert.equal("errorMessage" in log, false);
  }
  assert.deepEqual(
    logs.map((log) => [
      log.stage,
      log.outcome,
      log.method,
      log.routePath ?? null,
      log.status ?? null,
      log.policyName ?? null,
    ]),
    [
      ["request_received", "received", "GET", null, null, null],
      ["route_resolution", "matched", "GET", "/api/test", null, null],
      ["request_policy", "short_circuit", "GET", "/api/test", 401, "stop"],
      ["response_finalization", "completed", "GET", "/api/test", 401, null],
    ],
  );
});

test("executeGatewayRequest invokes origin and response policies for a matched route", async () => {
  const { ctx, flush } = createContext();
  const logs: Array<{ stage: string; outcome: string; status?: number; policyName?: string }> = [];
  const gateway = compileGateway(
    {
      origins: {
        "proxy-all": { type: "proxyAll", options: {} },
      },
      policies: {
        "pass-through": {
          type: "passThrough",
        },
        tag: {
          type: "tag",
          options: { header: "x-gateway", value: "edge" },
        },
      },
      routes: [
        {
          path: "/proxy/",
          methods: ["GET"],
          origin: "proxy-all",
          request: ["pass-through"],
          response: ["tag"],
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

test("executeGatewayRequest matches bare prefix routes", async () => {
  const { ctx, flush } = createContext();
  const logs: Array<{ stage: string; outcome: string; routePath?: string; status?: number }> = [];

  const gateway = compileGateway(
    {
      origins: {
        url: { type: "url", options: { url: "https://origin.example.com" } },
      },
      policies: {},
      routes: [
        {
          path: "/udemy/v2/api/",
          methods: ["GET"],
          origin: "url",
          request: [],
          response: [],
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
      ["response_finalization", "completed", "/udemy/v2/api/", 200],
    ],
  );
});

test("executeGatewayRequest matches bare prefixes without path segment boundaries", async () => {
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      origins: {
        "proxy-all": { type: "proxyAll", options: {} },
      },
      policies: {},
      routes: [
        {
          path: "/api",
          methods: ["GET"],
          origin: "proxy-all",
          request: [],
          response: [],
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: {
        proxyAll: async () => new Response("matched"),
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/apiary/secret"),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
  );

  await flush();

  assert.equal(response.status, 200);
});

test("executeGatewayRequest matches trailing-slash prefixes", async () => {
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      origins: {
        "proxy-all": { type: "proxyAll", options: {} },
      },
      policies: {},
      routes: [
        {
          path: "/api/",
          methods: ["GET"],
          origin: "proxy-all",
          request: [],
          response: [],
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: {
        proxyAll: async () => new Response("matched"),
      },
    },
  );

  const bareResponse = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api"),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
  );
  const childResponse = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/api/child"),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
  );

  await flush();

  assert.equal(bareResponse.status, 404);
  assert.equal(childResponse.status, 200);
});

test("executeGatewayRequest resolves exact routes before broader prefixes", async () => {
  const prefixRoute = {
    path: "/api/",
    methods: ["GET"],
    origin: "proxy-all",
    request: [],
    response: [],
  };
  const exactRoute = {
    path: "= /api/orders",
    methods: ["GET"],
    origin: "url",
    request: [],
    response: [],
  };
  const handlers = {
    requestPolicies: {},
    responsePolicies: {},
    origins: {
      proxyAll: async () => new Response("prefix"),
      url: async () => new Response("exact"),
    },
  };

  for (const routes of [
    [prefixRoute, exactRoute],
    [exactRoute, prefixRoute],
  ]) {
    const { ctx, flush } = createContext();
    const gateway = compileGateway(
      {
        origins: {
          "proxy-all": { type: "proxyAll", options: {} },
          url: { type: "url", options: { url: "https://origin.example.com" } },
        },
        policies: {},
        routes,
      },
      handlers,
    );
    const request = (path: string) => executeGatewayRequest(
      gateway,
      new Request(`https://gateway.example.com${path}`),
      { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
      ctx,
    );
    const response = await request("/api/orders");
    const childResponse = await request("/api/orders/1");
    const suffixedResponse = await request("/api/ordersx");

    await flush();

    assert.equal(await response.text(), "exact");
    assert.equal(await childResponse.text(), "prefix");
    assert.equal(await suffixedResponse.text(), "prefix");
  }
});

test("executeGatewayRequest follows nginx exact, prefix-stop, and regex selection order", async () => {
  const { ctx, flush } = createContext();
  const gateway = compileGateway({
    origins: {
      exact: { type: "exact" }, stop: { type: "stop" }, regex: { type: "regex" }, plain: { type: "plain" },
      later: { type: "later" }, insensitive: { type: "insensitive" },
    },
    policies: {},
    routes: [
      { path: "~ ^/a/b", methods: ["GET"], origin: "regex" },
      { path: "= /a", methods: ["GET"], origin: "exact" },
      { path: "^~ /a/", methods: ["GET"], origin: "stop" },
      { path: "/a/b/c", methods: ["GET"], origin: "plain" },
      { path: "~ ^/a/b", methods: ["POST"], origin: "later", auth: "none" },
      { path: "~* \\.PNG$", methods: ["GET"], origin: "insensitive" },
    ],
  }, {
    requestPolicies: {}, responsePolicies: {},
    origins: Object.fromEntries(["exact", "stop", "regex", "plain", "later", "insensitive"].map((name) => [name, async () => new Response(name)])),
  });
  const resolve = async (method: string, path: string) => {
    const response = await executeGatewayRequest(gateway, new Request(`https://gateway.example.com${path}`, { method }), {}, ctx);
    return response.text();
  };
  assert.equal(await resolve("GET", "/a"), "exact");
  assert.equal(await resolve("GET", "/a/b"), "stop");
  assert.equal(await resolve("GET", "/a/b/c/d"), "regex");
  assert.equal(await resolve("POST", "/a/b"), "later");
  assert.equal(await resolve("GET", "/x.png"), "insensitive");
  await flush();
});

test("an earlier regex wins over later regexes and longer plain prefixes, with prefix fallback", async () => {
  const { ctx, flush } = createContext();
  const gateway = compileGateway({
    origins: { plain: { type: "plain" }, first: { type: "first" }, second: { type: "second" } },
    policies: {},
    routes: [
      { path: "/a/b/c", methods: ["GET"], origin: "plain" },
      { path: "~ ^/a", methods: ["GET"], origin: "first" },
      { path: "~ ^/a/b", methods: ["GET"], origin: "second" },
    ],
  }, {
    requestPolicies: {}, responsePolicies: {},
    origins: { plain: async () => new Response("plain"), first: async () => new Response("first"), second: async () => new Response("second") },
  });
  const send = (path: string) => executeGatewayRequest(gateway, new Request(`https://gateway.example.com${path}`), {}, ctx);
  assert.equal(await (await send("/a/b/c/d")).text(), "first");
  await flush();

  const fallback = compileGateway({
    origins: { plain: { type: "plain" }, regex: { type: "regex" } }, policies: {},
    routes: [{ path: "/a/", methods: ["GET"], origin: "plain" }, { path: "~ ^/z", methods: ["GET"], origin: "regex" }],
  }, { requestPolicies: {}, responsePolicies: {}, origins: { plain: async () => new Response("plain"), regex: async () => new Response("regex") } });
  assert.equal(await (await executeGatewayRequest(fallback, new Request("https://gateway.example.com/a/q"), {}, ctx)).text(), "plain");
  await flush();
});

test("analytics and logs preserve the configured route path", async () => {
  const { ctx, flush } = createContext();
  const routePath = "~ ^/vault(/|$)";
  const gateway = compileGateway({
    origins: { vault: { type: "vault" } }, policies: {},
    routes: [{ path: routePath, methods: ["GET"], origin: "vault" }],
  }, {
    requestPolicies: {}, responsePolicies: {},
    origins: { vault: async () => new Response("ok") },
  });
  let analyticsPath = "";
  const loggedPaths: string[] = [];
  await executeGatewayRequest(gateway, new Request("https://gateway.example.com/vault/api"), {}, ctx, {
    logAnalytics: async (event) => { analyticsPath = event.routePath; },
    logEvent: (event) => { if (event.routePath) loggedPaths.push(event.routePath); },
  });
  await flush();
  assert.equal(analyticsPath, routePath);
  assert.ok(loggedPaths.length > 0);
  assert.ok(loggedPaths.every((path) => path === routePath));
});

test("executeGatewayRequest handles CORS preflight without hitting origin", async () => {
  const { ctx, flush } = createContext();
  const logs: Array<{ stage: string; outcome: string; routePath?: string; status?: number }> = [];
  let originCalls = 0;

  const gateway = compileGateway(
    {
      origins: {
        url: { type: "url", options: { url: "https://origin.example.com" } },
      },
      policies: {
        "cors-policy": {
          type: "cors",
          options: {
            allowedOrigins: ["http://localhost:3000"],
            allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["x-admin-key"],
            allowCredentials: true,
          },
        },
      },
      routes: [
        {
          path: "/udemy/v2/api/",
          methods: ["GET"],
          origin: "url",
          request: [],
          response: ["cors-policy"],
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {
        cors: (response: Response, options: { allowedOrigins: string[]; allowedMethods: string[] }) => {
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
      ["response_finalization", "completed", "/udemy/v2/api/", 204]
    ],
  );
});

test("executeGatewayRequest routes explicit OPTIONS requests to their origin", async () => {
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      origins: {
        url: { type: "url", options: { url: "https://origin.example.com" } },
      },
      policies: {},
      routes: [
        {
          path: "/options",
          methods: ["OPTIONS"],
          origin: "url",
          request: [],
          response: [],
        },
      ],
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: {
        url: async () => new Response("options-origin"),
      },
    },
  );

  const response = await executeGatewayRequest(
    gateway,
    new Request("https://gateway.example.com/options", { method: "OPTIONS" }),
    { ANALYTICS_ENABLED: "false", GATEWAY_NAME: "test-gateway" },
    ctx,
  );

  await flush();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "options-origin");
});

test("executeGatewayRequest finalizes route misses as 404 responses", async () => {
  const analytics: number[] = [];
  const logs: Array<{ stage: string; outcome: string; status?: number }> = [];
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      origins: {},
      policies: {},
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
      logAnalytics: async (event) => {
        analytics.push(event.status);
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
      ["response_finalization", "completed", 404],
    ],
  );
});

test("unavailable gateway responses include permissive CORS headers", async () => {
  const { ctx, flush } = createContext();
  const response = await executeUnavailableRequest(
    new Request("https://gateway.example.com/unavailable"),
    {
      ANALYTICS_ENABLED: "false",
      GATEWAY_NAME: "test-gateway",
      GATEWAY_CONFIG: {} as KVNamespace,
    },
    ctx,
  );

  await flush();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  );
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "*");
});

test("configuration resolution failures finalize as 503 with analytics and logs", async () => {
  const analytics: number[] = [];
  const logs: Array<{ stage: string; outcome: string; status?: number }> = [];
  const { ctx, flush } = createContext();
  const request = new Request("https://gateway.example.com/unavailable", {
    method: "OPTIONS",
    headers: { "access-control-request-method": "GET" },
  });

  const response = await executeUnavailableRequest(
    request,
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
      logAnalytics: async (event) => {
        analytics.push(event.status);
      },
    },
  );

  await flush();

  assert.equal(response.status, 503);
  assert.deepEqual(analytics, [503]);
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.status ?? null]),
    [
      ["request_received", "received", null],
      ["route_resolution", "matched", null],
      ["origin", "started", null],
      ["origin", "completed", 503],
      ["response_finalization", "completed", 503],
    ],
  );
});

test("executeGatewayRequest finalizes unexpected failures as 500 responses", async () => {
  const analytics: number[] = [];
  const logs: Array<{ stage: string; outcome: string; status?: number; reason?: string }> = [];
  const { ctx, flush } = createContext();
  const gateway = compileGateway(
    {
      origins: {
        url: { type: "url", options: {} },
      },
      policies: {},
      routes: [
        {
          path: "/api/fail",
          methods: ["GET"],
          origin: "url",
          request: [],
          response: [],
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
          reason: event.reason,
        });
      },
      logAnalytics: async (event) => {
        analytics.push(event.status);
      },
    },
  );

  await flush();

  assert.equal(response.status, 500);
  assert.equal(analytics[0], 500);
  assert.equal(logs.find((log) => log.stage === "execution")?.reason, "boom");
  assert.deepEqual(
    logs.map((log) => [log.stage, log.outcome, log.status ?? null]),
    [
      ["request_received", "received", null],
      ["route_resolution", "matched", null],
      ["origin", "started", null],
      ["execution", "failed", 500],
      ["response_finalization", "completed", 500],
    ],
  );
});
