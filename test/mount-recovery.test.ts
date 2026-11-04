import test from "node:test";
import assert from "node:assert/strict";

import { resolveMountRequest } from "../src/gateway/mounts.ts";
import { compileGateway } from "../src/gateway/compiler.ts";
import { executeGatewayRequest, resolveRoute } from "../src/gateway/runtime.ts";
import { url as urlOrigin } from "../src/origins/url.ts";
import type {
  CompiledGateway,
  GatewayConfig,
  GatewayExecutionContext,
  GatewayHandlers,
} from "../src/gateway/types.ts";

const makeGateway = (routes: Array<Record<string, unknown>>): CompiledGateway => {
  const routeConfig = routes.map((route) => ({
    methods: ["GET"],
    origin: "capture",
    ...route,
  }));
  return compileGateway(
    {
      origins: { capture: { type: "capture" } },
      policies: {},
      routes: routeConfig as never,
    },
    {
      requestPolicies: {},
      responsePolicies: {},
      origins: { capture: async () => new Response("capture") },
    },
  );
};

const resolve = (gateway: CompiledGateway, request: Request) =>
  resolveMountRequest(gateway, request, new URL(request.url), (url) => {
    return resolveRoute(gateway, request.method, url);
  });

const request = (path: string, headers?: HeadersInit) =>
  new Request(`https://gateway.example.test${path}`, { headers });

const makeMountedGateway = (options: {
  origin: GatewayHandlers["origins"][string];
  originType?: string;
  originOptions?: Record<string, unknown>;
  originName?: string;
  methods?: string[];
  requestPolicies?: string[];
  responsePolicies?: string[];
  policies?: GatewayConfig["policies"];
  requestHandlers?: GatewayHandlers["requestPolicies"];
  responseHandlers?: GatewayHandlers["responsePolicies"];
}) => {
  const originName = options.originName ?? "app";
  return compileGateway(
    {
      origins: {
        [originName]: {
          type: options.originType ?? "app",
          options: options.originOptions,
        },
      },
      policies: options.policies ?? {},
      routes: [
        {
          path: "/app/",
          methods: options.methods ?? ["GET"],
          origin: originName,
          request: options.requestPolicies ?? [],
          response: options.responsePolicies ?? [],
          mount: "/app",
          auth: "none",
        },
      ],
    },
    {
      requestPolicies: options.requestHandlers ?? {},
      responsePolicies: options.responseHandlers ?? {},
      origins: { [originName]: options.origin },
    },
  );
};

const runGateway = (
  gateway: CompiledGateway,
  path: string,
  init: RequestInit = {},
  dependencies: Parameters<typeof executeGatewayRequest>[4] = {},
) =>
  executeGatewayRequest(
    gateway,
    new Request(`https://gateway.example.test${path}`, init),
    {},
    {
      waitUntil() {},
      passThroughOnException() {},
    } as GatewayExecutionContext,
    dependencies,
  );

test("rule 1: a path under a mount is routed normally and cannot be overridden", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "/other/", mount: "/other" },
  ]);
  const result = resolve(
    gateway,
    request("/app/dashboard", { referer: "https://gateway.example.test/other/start" }),
  );
  assert.equal(result.requestUrl.pathname, "/app/dashboard");
  assert.equal(result.route?.path, "/app/");
  assert.equal(result.source, undefined);
});

test("rule 2: a same-origin Referer recovers to its longest declared mount", () => {
  const gateway = makeGateway([{ path: "/app/", mount: "/app" }]);
  const result = resolve(
    gateway,
    request("/dashboard", { referer: "https://gateway.example.test/app/home" }),
  );
  assert.equal(result.requestUrl.pathname, "/app/dashboard");
  assert.equal(result.route?.path, "/app/");
  assert.equal(result.mount, "/app");
  assert.equal(result.source, "referer");
});

test("rule 3: a normal route wins before a mount context cookie", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /health" },
  ]);
  const result = resolve(
    gateway,
    request("/health", { cookie: "__Host-gw_mount=/app" }),
  );
  assert.equal(result.requestUrl.pathname, "/health");
  assert.equal(result.route?.path, "= /health");
  assert.equal(result.source, undefined);
});

test("rule 4: the context cookie recovers only a route miss", () => {
  const gateway = makeGateway([{ path: "/app/", mount: "/app" }]);
  const result = resolve(
    gateway,
    request("/dashboard", { cookie: "session=abc; __Host-gw_mount=/app" }),
  );
  assert.equal(result.requestUrl.pathname, "/app/dashboard");
  assert.equal(result.route?.path, "/app/");
  assert.equal(result.source, "cookie");
});

test("rule 5: an unresolved request remains a route miss", () => {
  const gateway = makeGateway([{ path: "/app/", mount: "/app" }]);
  const result = resolve(gateway, request("/missing"));
  assert.equal(result.requestUrl.pathname, "/missing");
  assert.equal(result.route, undefined);
  assert.equal(result.source, undefined);
});

test("a same-origin Referer mount overrides a matching normal route", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", { referer: "https://gateway.example.test/app/home" }),
  );
  assert.equal(result.route?.path, "/app/");
  assert.equal(result.requestUrl.pathname, "/app/dashboard");
  assert.equal(result.source, "referer");
});

test("a context cookie is ignored when the request already has a normal route", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", { cookie: "__Host-gw_mount=/app" }),
  );
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("a cross-origin Referer is ignored", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", { referer: "https://other.example.test/app/home" }),
  );
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("a different-scheme Referer is ignored", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", { referer: "http://gateway.example.test/app/home" }),
  );
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("a different-port Referer is ignored", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", {
      referer: "https://gateway.example.test:8443/app/home",
    }),
  );
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("a lookalike-host Referer is ignored", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", {
      referer: "https://gateway.example.test.evil.test/app/home",
    }),
  );
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("an unparseable Referer is ignored", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(gateway, request("/dashboard", { referer: "not a URL" }));
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("a context cookie naming a stale mount is ignored", () => {
  const gateway = makeGateway([
    { path: "/app/", mount: "/app" },
    { path: "= /dashboard" },
  ]);
  const result = resolve(
    gateway,
    request("/dashboard", { cookie: "__Host-gw_mount=/removed" }),
  );
  assert.equal(result.route?.path, "= /dashboard");
  assert.equal(result.requestUrl.pathname, "/dashboard");
  assert.equal(result.source, undefined);
});

test("a Referer candidate without a route falls through to a normal route", () => {
  const gateway = makeGateway([
    { path: "= /app/", mount: "/app" },
    { path: "= /missing" },
  ]);
  const result = resolve(
    gateway,
    request("/missing", { referer: "https://gateway.example.test/app/home" }),
  );
  assert.equal(result.route?.path, "= /missing");
  assert.equal(result.requestUrl.pathname, "/missing");
  assert.equal(result.source, undefined);
});

test("an empty mount list resolves normally without reading recovery headers", () => {
  const gateway = makeGateway([{ path: "= /health" }]);
  const headerlessRequest = {
    get headers(): Headers {
      throw new Error("mount recovery headers must not be read");
    },
  } as Request;
  const url = new URL("https://gateway.example.test/health");
  const result = resolveMountRequest(gateway, headerlessRequest, url, (candidateUrl) =>
    resolveRoute(gateway, "GET", candidateUrl),
  );

  assert.equal(result.requestUrl.pathname, "/health");
  assert.equal(result.route?.path, "= /health");
  assert.equal(result.source, undefined);
});

test("a mounted navigation redirects with its path and query and Vary", async () => {
  let originCalls = 0;
  const gateway = makeMountedGateway({
    origin: async () => {
      originCalls += 1;
      return new Response("should not run");
    },
  });
  const response = await runGateway(gateway, "/dashboard?tab=one", {
    headers: {
      referer: "https://gateway.example.test/app/home",
      "sec-fetch-mode": "navigate",
    },
  });

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/app/dashboard?tab=one");
  assert.equal(response.headers.get("vary"), "Referer, Cookie");
  assert.deepEqual(response.headers.getSetCookie(), [
    "__Host-gw_mount=/app; Path=/; Secure; HttpOnly; SameSite=Lax",
  ]);
  assert.equal(originCalls, 0);
});

test("mounted fetch, WebSocket, and requests without Sec-Fetch-Mode dispatch internally", async () => {
  const upstreamPaths: string[] = [];
  const gateway = makeMountedGateway({
    origin: async (request) => {
      upstreamPaths.push(new URL(request.url).pathname);
      return new Response("dispatched", { headers: { vary: "Accept-Encoding" } });
    },
  });

  const requestHeaders: HeadersInit[] = [
    {
      referer: "https://gateway.example.test/app/home",
      "sec-fetch-mode": "cors",
    },
    { referer: "https://gateway.example.test/app/home", upgrade: "websocket" },
    { referer: "https://gateway.example.test/app/home" },
  ];
  for (const headers of requestHeaders) {
    const response = await runGateway(gateway, "/assets/app.js", { headers });
    assert.equal(await response.text(), "dispatched");
    assert.equal(response.headers.get("vary"), "Accept-Encoding, Referer, Cookie");
  }

  assert.deepEqual(upstreamPaths, [
    "/app/assets/app.js",
    "/app/assets/app.js",
    "/app/assets/app.js",
  ]);
});

test("internal dispatch preserves a POST method, headers, and body", async () => {
  let captured: {
    method: string;
    token: string | null;
    cookie: string | null;
    body: string;
  } | undefined;
  const gateway = makeMountedGateway({
    methods: ["POST"],
    origin: async (request) => {
      captured = {
        method: request.method,
        token: request.headers.get("x-request-token"),
        cookie: request.headers.get("cookie"),
        body: await request.text(),
      };
      return new Response("created", { status: 201 });
    },
  });

  const response = await runGateway(gateway, "/orders?source=ui", {
    method: "POST",
    headers: {
      referer: "https://gateway.example.test/app/orders",
      cookie: "session=ok; __Host-gw_mount=/app",
      "x-request-token": "token-123",
      "content-type": "text/plain",
    },
    body: "payload",
  });

  assert.equal(response.status, 201);
  assert.deepEqual(captured, {
    method: "POST",
    token: "token-123",
    cookie: "session=ok",
    body: "payload",
  });
});

test("the url origin receives the recovered path after stripPrefix", async () => {
  const originalFetch = globalThis.fetch;
  let fetchedUrl = "";
  globalThis.fetch = async (input) => {
    fetchedUrl = input instanceof Request ? input.url : String(input);
    return new Response("upstream");
  };

  try {
    const gateway = compileGateway(
      {
        origins: {
          app: {
            type: "url",
            options: { url: "https://upstream.example.test", stripPrefix: "/app" },
          },
        },
        policies: {},
        routes: [
          {
            path: "/app/",
            methods: ["GET"],
            origin: "app",
            mount: "/app",
            auth: "none",
          },
        ],
      },
      {
        requestPolicies: {},
        responsePolicies: {},
        origins: { url: urlOrigin },
      },
    );
    const response = await runGateway(gateway, "/api/x?version=1", {
      headers: { referer: "https://gateway.example.test/app/home" },
    });

    assert.equal(await response.text(), "upstream");
    assert.equal(fetchedUrl, "https://upstream.example.test/api/x?version=1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovered OPTIONS preflight resolves using the requested method", async () => {
  let originCalls = 0;
  const gateway = makeMountedGateway({
    responsePolicies: ["mark-preflight"],
    policies: { "mark-preflight": { type: "mark-preflight" } },
    responseHandlers: {
      "mark-preflight": (response) => {
        response.headers.set("x-preflight-route", "matched");
      },
    },
    origin: async () => {
      originCalls += 1;
      return new Response("origin");
    },
  });
  const response = await runGateway(gateway, "/api/data", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "GET",
      referer: "https://gateway.example.test/app/home",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-preflight-route"), "matched");
  assert.equal(response.headers.get("vary"), "Referer, Cookie");
  assert.equal(originCalls, 0);
});

test("a mounted navigation appends the context cookie and preserves upstream cookies", async () => {
  const gateway = makeMountedGateway({
    origin: async () => {
      const response = new Response("page");
      response.headers.append("Set-Cookie", "upstream=one; HttpOnly");
      response.headers.append("Set-Cookie", "theme=dark; Path=/");
      return response;
    },
  });
  const response = await runGateway(gateway, "/app/home", {
    headers: { "sec-fetch-mode": "navigate" },
  });

  assert.deepEqual(response.headers.getSetCookie(), [
    "gwm_app__upstream=one; HttpOnly; Path=/",
    "theme=dark; Path=/",
    "__Host-gw_mount=/app; Path=/; Secure; HttpOnly; SameSite=Lax",
  ]);
});

test("a non-navigation under a mount does not set the context cookie", async () => {
  const gateway = makeMountedGateway({ origin: async () => new Response("asset") });
  const response = await runGateway(gateway, "/app/assets/app.js", {
    headers: { "sec-fetch-mode": "cors" },
  });

  assert.deepEqual(response.headers.getSetCookie(), []);
});

test("the context cookie is removed before policies and origins on mounted and unmounted routes", async () => {
  const policyCookies: Array<string | null> = [];
  const originCookies: Array<string | null> = [];
  const gateway = compileGateway(
    {
      origins: { capture: { type: "capture" } },
      policies: { inspect: { type: "inspect" } },
      routes: [
        {
          path: "/app/",
          methods: ["GET"],
          origin: "capture",
          request: ["inspect"],
          mount: "/app",
          auth: "none",
        },
        {
          path: "/public/",
          methods: ["GET"],
          origin: "capture",
          request: ["inspect"],
        },
      ],
    },
    {
      requestPolicies: {
        inspect: async (request) => {
          policyCookies.push(request.headers.get("cookie"));
          return request;
        },
      },
      responsePolicies: {},
      origins: {
        capture: async (request) => {
          originCookies.push(request.headers.get("cookie"));
          return new Response("ok");
        },
      },
    },
  );
  const headers = {
    cookie: "first=1; __Host-gw_mount=/app; keep; last=3",
  };

  await runGateway(gateway, "/app/items", { headers });
  await runGateway(gateway, "/public/items", { headers });
  await runGateway(gateway, "/public/items", {
    headers: { cookie: "__Host-gw_mount=/app" },
  });

  assert.deepEqual(policyCookies, [
    "first=1; keep; last=3",
    "first=1; keep; last=3",
    null,
  ]);
  assert.deepEqual(originCookies, [
    "first=1; keep; last=3",
    "first=1; keep; last=3",
    null,
  ]);
});

test("each recovery emits one mount_recovery event with its outcome and source", async () => {
  const gateway = makeMountedGateway({ origin: async () => new Response("ok") });
  const scenarios: Array<{
    headers: HeadersInit;
    outcome: string;
    source: string;
  }> = [
    {
      headers: {
        referer: "https://gateway.example.test/app/home",
        "sec-fetch-mode": "navigate",
      },
      outcome: "redirected",
      source: "referer",
    },
    {
      headers: {
        referer: "https://gateway.example.test/app/home",
        "sec-fetch-mode": "cors",
      },
      outcome: "dispatched",
      source: "referer",
    },
    {
      headers: {
        cookie: "__Host-gw_mount=/app",
        "sec-fetch-mode": "navigate",
      },
      outcome: "redirected",
      source: "cookie",
    },
    {
      headers: { cookie: "__Host-gw_mount=/app" },
      outcome: "dispatched",
      source: "cookie",
    },
  ];

  for (const scenario of scenarios) {
    const events: Array<{
      stage: string;
      outcome: string;
      source?: string;
      routePath?: string;
      method?: string;
    }> = [];
    await runGateway(
      gateway,
      "/dashboard",
      { headers: scenario.headers },
      {
        logEvent: (event) =>
          events.push({
            stage: event.stage,
            outcome: event.outcome,
            source: event.source,
            routePath: event.routePath,
            method: event.method,
          }),
      },
    );

    assert.deepEqual(
      events.filter((event) => event.stage === "mount_recovery"),
      [
        {
          stage: "mount_recovery",
          outcome: scenario.outcome,
          source: scenario.source,
          routePath: "/app/",
          method: "GET",
        },
      ],
    );
    assert.equal(
      events.filter((event) => event.stage === "response_finalization").length,
      1,
    );
  }
});

test("the recovered target route runs request and response policies and finalizes once", async () => {
  const events: Array<{ stage: string; routePath?: string }> = [];
  let requestPolicyPath = "";
  let responsePolicyPath = "";
  const gateway = makeMountedGateway({
    requestPolicies: ["capture-request"],
    responsePolicies: ["capture-response"],
    policies: {
      "capture-request": { type: "capture-request" },
      "capture-response": { type: "capture-response" },
    },
    requestHandlers: {
      "capture-request": async (request) => {
        requestPolicyPath = new URL(request.url).pathname;
        return request;
      },
    },
    responseHandlers: {
      "capture-response": (response, _options, request) => {
        responsePolicyPath = new URL(request!.url).pathname;
        response.headers.set("x-response-policy", "ran");
      },
    },
    origin: async () => new Response("ok"),
  });

  const response = await runGateway(
    gateway,
    "/api/data",
    { headers: { referer: "https://gateway.example.test/app/home" } },
    { logEvent: (event) => events.push({ stage: event.stage, routePath: event.routePath }) },
  );

  assert.equal(response.headers.get("x-response-policy"), "ran");
  assert.equal(requestPolicyPath, "/app/api/data");
  assert.equal(responsePolicyPath, "/app/api/data");
  assert.deepEqual(
    events.filter((event) => event.stage === "response_finalization"),
    [{ stage: "response_finalization", routePath: "/app/" }],
  );
});
