import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { compileGateway } from "../src/gateway/compiler.ts";
import { executeGatewayRequest } from "../src/gateway/runtime.ts";
import { url as urlOrigin } from "../src/origins/url.ts";
import type {
  GatewayExecutionContext,
  GatewayHandlers,
} from "../src/gateway/types.ts";

const makeGateway = (options: {
  mount?: string;
  origin?: GatewayHandlers["origins"][string];
  requestPolicy?: GatewayHandlers["requestPolicies"][string];
  responsePolicy?: GatewayHandlers["responsePolicies"][string];
} = {}) => {
  const mount = options.mount;
  return compileGateway(
    {
      origins: { app: { type: "app" } },
      policies: {
        ...(options.requestPolicy ? { stop: { type: "stop" } } : {}),
        ...(options.responsePolicy ? { observe: { type: "observe" } } : {}),
      },
      routes: [
        {
          path: mount ? `${mount}/` : "/app/",
          methods: ["GET"],
          origin: "app",
          ...(mount ? { mount } : {}),
          ...(options.requestPolicy ? { request: ["stop"] } : {}),
          ...(options.responsePolicy ? { response: ["observe"] } : {}),
          auth: "none",
        },
      ],
    },
    {
      requestPolicies: options.requestPolicy ? { stop: options.requestPolicy } : {},
      responsePolicies: options.responsePolicy ? { observe: options.responsePolicy } : {},
      origins: {
        app: options.origin ?? (async () => new Response("origin")),
      },
    },
  );
};

const runGateway = (
  gateway: ReturnType<typeof makeGateway>,
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

const responseWithCookies = (...cookies: string[]) => {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response("origin", { headers });
};

const setCookies = (response: Response) => response.headers.getSetCookie();
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("namespaces HttpOnly cookies and forces Path=/, replacing or adding Path", async () => {
  const gateway = makeGateway({
    mount: "/open-design",
    origin: async () =>
      responseWithCookies(
        "sid=one; Path=/old; HttpOnly; SameSite=Lax",
        "prefs=two; HttpOnly; Secure",
      ),
  });

  const response = await runGateway(gateway, "/open-design/home");

  assert.deepEqual(setCookies(response), [
    "gwm_open-design__sid=one; Path=/; HttpOnly; SameSite=Lax",
    "gwm_open-design__prefs=two; HttpOnly; Secure; Path=/",
  ]);
});

test("keeps __Host- and __Secure- prefixes and matches HttpOnly case-insensitively", async () => {
  const gateway = makeGateway({
    mount: "/a/b",
    origin: async () =>
      responseWithCookies(
        "__Host-sid=one; Path=/; httponly; Secure",
        "__Secure-token=two; HttpOnly; Path=/api",
        "__hOsT-Mixed=three; HttpOnly; Path=/custom",
        "__sEcUrE-Mixed= Four; HttpOnly; Path=/custom",
      ),
  });

  const response = await runGateway(gateway, "/a/b/home");

  assert.deepEqual(setCookies(response), [
    "__Host-gwm_a.b__sid=one; Path=/; httponly; Secure",
    "__Secure-gwm_a.b__token=two; HttpOnly; Path=/",
    "__hOsT-gwm_a.b__Mixed=three; HttpOnly; Path=/",
    "__sEcUrE-gwm_a.b__Mixed= Four; HttpOnly; Path=/",
  ]);
});

test("emits deleting cookies under both names for Max-Age and past Expires", async () => {
  const gateway = makeGateway({
    mount: "/app",
    origin: async () =>
      responseWithCookies(
        "old=; Max-Age=0; Path=/old",
        "sid=; Max-Age=0; Path=/app; HttpOnly",
        "theme=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/theme",
        "__Secure-token=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; HttpOnly; Path=/app",
      ),
  });

  const response = await runGateway(
    gateway,
    "/app/home",
    {},
    { now: () => Date.parse("2030-01-01T00:00:00Z") },
  );

  assert.deepEqual(setCookies(response), [
    "old=; Max-Age=0; Path=/old",
    "gwm_app__old=; Max-Age=0; Path=/",
    "sid=; Max-Age=0; Path=/app; HttpOnly",
    "gwm_app__sid=; Max-Age=0; Path=/; HttpOnly",
    "theme=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/theme",
    "gwm_app__theme=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/",
    "__Secure-token=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; HttpOnly; Path=/app",
    "__Secure-gwm_app__token=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; HttpOnly; Path=/",
  ]);
});

test("treats positive Max-Age as authoritative over a past Expires date", async () => {
  const gateway = makeGateway({
    mount: "/app",
    origin: async () =>
      responseWithCookies(
        "sid=alive; Max-Age=3600; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/",
      ),
  });

  const response = await runGateway(
    gateway,
    "/app/home",
    {},
    { now: () => Date.parse("2030-01-01T00:00:00Z") },
  );

  assert.deepEqual(setCookies(response), [
    "sid=alive; Max-Age=3600; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/",
  ]);
});

test("recognizes Max-Age=-1 and lowercase max-age and path attributes", async () => {
  const gateway = makeGateway({
    mount: "/app",
    origin: async () =>
      responseWithCookies(
        "negative=; Max-Age=-1; Path=/original",
        "lower=; max-age=-1; path=/original; httponly",
      ),
  });

  const response = await runGateway(gateway, "/app/home");

  assert.deepEqual(setCookies(response), [
    "negative=; Max-Age=-1; Path=/original",
    "gwm_app__negative=; Max-Age=-1; Path=/",
    "lower=; max-age=-1; path=/original; httponly",
    "gwm_app__lower=; max-age=-1; Path=/; httponly",
  ]);
});

test("does not emit an Expires deletion copy when injected now is earlier than Expires", async () => {
  const gateway = makeGateway({
    mount: "/app",
    origin: async () =>
      responseWithCookies("sid=alive; Expires=Wed, 21 Oct 2035 07:28:00 GMT; HttpOnly"),
  });

  const response = await runGateway(
    gateway,
    "/app/home",
    {},
    { now: () => Date.parse("2030-01-01T00:00:00Z") },
  );

  assert.deepEqual(setCookies(response), [
    "gwm_app__sid=alive; Expires=Wed, 21 Oct 2035 07:28:00 GMT; HttpOnly; Path=/",
  ]);
});

test("passes non-HttpOnly cookies through unchanged and preserves separate Set-Cookie values", async () => {
  const gateway = makeGateway({
    mount: "/app",
    origin: async () =>
      responseWithCookies(
        "theme=dark; Path=/; SameSite=Lax",
        "expired=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/",
        "loose-cookie-pair",
        "loose; Max-Age=0; HttpOnly",
      ),
  });

  const response = await runGateway(gateway, "/app/home", {}, { now: () => Date.parse("2030-01-01") });

  assert.deepEqual(setCookies(response), [
    "theme=dark; Path=/; SameSite=Lax",
    "expired=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/",
    "gwm_app__expired=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/",
    "loose-cookie-pair",
    "loose; Max-Age=0; HttpOnly",
  ]);
});

test("passes the rewritten Set-Cookie value to response policies", async () => {
  let observedCookies: string[] = [];
  const gateway = makeGateway({
    mount: "/app",
    responsePolicy: (response) => {
      observedCookies = setCookies(response);
    },
    origin: async () => responseWithCookies("sid=upstream; HttpOnly; Path=/app"),
  });

  const response = await runGateway(gateway, "/app/home");

  assert.deepEqual(observedCookies, ["gwm_app__sid=upstream; HttpOnly; Path=/"]);
  assert.deepEqual(setCookies(response), observedCookies);
});

test("does not rewrite a response carrying a WebSocket", async () => {
  const websocketResponse = responseWithCookies("sid=upstream; HttpOnly; Path=/app");
  Object.defineProperty(websocketResponse, "webSocket", { value: {} });
  const gateway = makeGateway({
    mount: "/app",
    origin: async () => websocketResponse,
  });

  const response = await runGateway(gateway, "/app/socket");

  assert.strictEqual(response, websocketResponse);
  assert.deepEqual(setCookies(response), ["sid=upstream; HttpOnly; Path=/app"]);
});

test("does not rewrite unmounted routes or request-policy short-circuit responses", async () => {
  const upstreamCookie = "sid=upstream; HttpOnly; Path=/app";
  const unmounted = makeGateway({
    origin: async () => responseWithCookies(upstreamCookie),
  });
  const unmountedResponse = await runGateway(unmounted, "/app/home");
  assert.deepEqual(setCookies(unmountedResponse), [upstreamCookie]);

  const shortCircuit = makeGateway({
    mount: "/app",
    requestPolicy: async () => responseWithCookies("sid=policy; HttpOnly; Path=/app"),
    origin: async () => {
      throw new Error("origin must not run");
    },
  });
  const policyResponse = await runGateway(shortCircuit, "/app/home");
  assert.deepEqual(setCookies(policyResponse), ["sid=policy; HttpOnly; Path=/app"]);
});

test("keeps the Phase 2 context cookie appended after mounted origin cookies", async () => {
  const gateway = makeGateway({
    mount: "/app",
    origin: async () => responseWithCookies("sid=upstream; HttpOnly; Path=/app"),
  });

  const response = await runGateway(gateway, "/app/home", {
    headers: { "sec-fetch-mode": "navigate" },
  });

  assert.deepEqual(setCookies(response), [
    "gwm_app__sid=upstream; HttpOnly; Path=/",
    "__Host-gw_mount=/app; Path=/; Secure; HttpOnly; SameSite=Lax",
  ]);
});

test("never namespaces or restores the reserved mount context cookie name", async () => {
  let forwardedCookie: string | null = null;
  const gateway = makeGateway({
    mount: "/app",
    origin: async (request) => {
      forwardedCookie = request.headers.get("cookie");
      return responseWithCookies(
        "__Host-gw_mount=/other; Path=/; Secure; HttpOnly",
      );
    },
  });

  const response = await runGateway(gateway, "/app/home", {
    headers: { cookie: "__Host-gwm_app__gw_mount=/other; ordinary=ok" },
  });

  assert.deepEqual(setCookies(response), [
    "__Host-gw_mount=/other; Path=/; Secure; HttpOnly",
  ]);
  assert.equal(forwardedCookie, "ordinary=ok");
});

test("restores this mount's cookies, drops plain duplicates and other mounts, and keeps other pair order", async () => {
  let forwardedCookie: string | null = null;
  const gateway = makeGateway({
    mount: "/app",
    origin: async (request) => {
      forwardedCookie = request.headers.get("cookie");
      return new Response("origin");
    },
  });

  await runGateway(gateway, "/app/home", {
    headers: {
      cookie:
        "first=1; gwm_app__sid=owned; bare; sid=plain; __Secure-gwm_app__token=secure; __Host-gwm_app__hosted=secure; __Host-hosted=plain; __hOsT-gwm_app__Case=host; __sEcUrE-gwm_app__TOKEN=secure; __Host-gwm_other__id=other; gwm_other__plain=no; __Host-gwm_app__gw_mount=/other; last=2; __Host-gw_mount=/app",
    },
  });

  assert.equal(
    forwardedCookie,
    "first=1; sid=owned; bare; __Secure-token=secure; __Host-hosted=secure; __hOsT-Case=host; __sEcUrE-TOKEN=secure; last=2",
  );
});

test("filters cookies for the selected namespace on a Referer-recovered dispatch", async () => {
  let forwardedCookie: string | null = null;
  const gateway = makeGateway({
    mount: "/app",
    origin: async (request) => {
      forwardedCookie = request.headers.get("cookie");
      return new Response("origin");
    },
  });

  await runGateway(gateway, "/assets/logo.svg", {
    headers: {
      referer: "https://gateway.example.test/app/home",
      cookie: "gwm_app__sid=owned; gwm_other__sid=other; gwm_app__theme=dark",
    },
  });

  assert.equal(forwardedCookie, "sid=owned; theme=dark");
});

test("drops every namespaced cookie and the mount context on unmounted routes", async () => {
  let forwardedCookie: string | null = null;
  const gateway = makeGateway({
    origin: async (request) => {
      forwardedCookie = request.headers.get("cookie");
      return new Response("origin");
    },
  });

  await runGateway(gateway, "/app/home", {
    headers: {
      cookie:
        "first=1; gwm_app__sid=secret; __Host-gwm_b__id=other; bare; last=2; __Host-gw_mount=/app",
    },
  });
  assert.equal(forwardedCookie, "first=1; bare; last=2");

  await runGateway(gateway, "/app/home", {
    headers: { cookie: "gwm_app__sid=secret; __Host-gw_mount=/app" },
  });
  assert.equal(forwardedCookie, null);

  await runGateway(gateway, "/app/home", { headers: { cookie: "" } });
  assert.equal(forwardedCookie, null);

  await runGateway(gateway, "/app/home", { headers: { cookie: " ; ;" } });
  assert.equal(forwardedCookie, null);
});

test("a mounted session cookie never reaches another mount's upstream fetch", async () => {
  const fetched: Array<{ hostname: string; cookie: string | null }> = [];
  globalThis.fetch = async (input) => {
    const upstreamRequest = input instanceof Request ? input : new Request(input);
    const upstreamUrl = new URL(upstreamRequest.url);
    fetched.push({ hostname: upstreamUrl.hostname, cookie: upstreamRequest.headers.get("cookie") });
    return upstreamUrl.hostname === "a.upstream.test"
      ? responseWithCookies("sid=secret; HttpOnly; Path=/")
      : new Response("other app");
  };

  const gateway = compileGateway(
    {
      origins: {
        appA: {
          type: "url",
          options: { url: "https://a.upstream.test", stripPrefix: "/a" },
        },
        appB: {
          type: "url",
          options: { url: "https://b.upstream.test", stripPrefix: "/b" },
        },
      },
      policies: {},
      routes: [
        { path: "/a/", methods: ["GET"], origin: "appA", mount: "/a", auth: "none" },
        { path: "/b/", methods: ["GET"], origin: "appB", mount: "/b", auth: "none" },
      ],
    },
    { requestPolicies: {}, responsePolicies: {}, origins: { url: urlOrigin } },
  );

  const appAResponse = await runGateway(gateway, "/a/login");
  assert.deepEqual(setCookies(appAResponse), ["gwm_a__sid=secret; HttpOnly; Path=/"]);
  await runGateway(gateway, "/a/profile", {
    headers: { cookie: "gwm_a__sid=secret" },
  });
  await runGateway(gateway, "/b/profile", {
    headers: { cookie: "gwm_a__sid=secret" },
  });

  assert.deepEqual(fetched, [
    { hostname: "a.upstream.test", cookie: null },
    { hostname: "a.upstream.test", cookie: "sid=secret" },
    { hostname: "b.upstream.test", cookie: null },
  ]);
});
