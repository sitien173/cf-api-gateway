import test from "node:test";
import assert from "node:assert/strict";

import { proxyAll, upstreamWithFallback, url } from "../src/origins/index.ts";
import { emitGatewayLog } from "../src/gateway/logging.ts";
import type { OriginContext } from "../src/types/index.ts";

// Origin events reach the console through the same logger the runtime falls back to.
const originContext: OriginContext = {
  waitUntil: () => {},
  log: (event) => emitGatewayLog(undefined, event),
};

type LoggedEvent = Record<string, unknown>;

const withCapturedConsole = async (
  run: (logs: { info: LoggedEvent[]; error: LoggedEvent[] }) => Promise<void>,
) => {
  const logs = {
    info: [] as LoggedEvent[],
    error: [] as LoggedEvent[],
  };

  const originalInfo = console.info;
  const originalError = console.error;

  console.info = ((event: LoggedEvent) => {
    logs.info.push(event);
  }) as typeof console.info;

  console.error = ((event: LoggedEvent) => {
    logs.error.push(event);
  }) as typeof console.error;

  try {
    await run(logs);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
};

test("emitGatewayLog suppresses info below the configured level", () => {
  const events: Array<{ level: string }> = [];
  const logger = (event: { level: string }) => events.push(event);

  emitGatewayLog(logger, { level: "info", stage: "test", outcome: "test" }, { GATEWAY_LOG_LEVEL: "error" });
  emitGatewayLog(logger, { level: "error", stage: "test", outcome: "test" }, { GATEWAY_LOG_LEVEL: "error" });

  assert.deepEqual(events, [{ level: "error", stage: "test", outcome: "test" }]);
});

test("proxyAll alias logs primary failure and fallback completion as upstreamWithFallback", async () => {
  const originalFetch = globalThis.fetch;
  const primaryUrl = "https://primary-proxyall.example.com";
  const fallbackUrl = "https://fallback-proxyall.example.com";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === `${primaryUrl}/api/health`) {
      return new Response("ok", { status: 200 });
    }

    if (url === `${primaryUrl}/orders?id=1`) {
      return new Response("primary failed", { status: 503 });
    }

    if (url === `${fallbackUrl}/orders?id=1`) {
      return new Response("fallback ok", { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await withCapturedConsole(async (logs) => {
      const response = await proxyAll(new Request("https://gateway.example.com/orders?id=1"), {
        primaryUrl,
        fallbackUrl,
        healthCheckCacheTtl: 0,
      }, originContext);

      assert.equal(response.status, 200);
      assert.deepEqual(
        logs.info
          .filter((event) =>
            event.outcome === "primary_failed" || event.outcome === "fallback_completed",
          )
          .map((event) => [event.stage, event.outcome, event.status, event.method, event.originType]),
        [
          ["origin", "primary_failed", 503, "GET", "upstreamWithFallback"],
          ["origin", "fallback_completed", 200, "GET", "upstreamWithFallback"],
        ],
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstreamWithFallback logs primary failure and fallback completion with structured context", async () => {
  const originalFetch = globalThis.fetch;
  const primaryUrl = "https://primary-upstream.example.com";
  const fallbackUrl = "https://fallback-upstream.example.com";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === `${primaryUrl}/api/health`) {
      return new Response("ok", { status: 200 });
    }

    if (url === `${primaryUrl}/orders?id=1`) {
      return new Response("primary failed", { status: 503 });
    }

    if (url === `${fallbackUrl}/orders?id=1`) {
      return new Response("fallback ok", { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await withCapturedConsole(async (logs) => {
      const response = await upstreamWithFallback(
        new Request("https://gateway.example.com/orders?id=1"),
        {
          primaryUrl,
          fallbackUrl,
          healthCheckCacheTtl: 0,
        },
        originContext,
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        logs.info
          .filter((event) =>
            event.outcome === "primary_failed" || event.outcome === "fallback_completed",
          )
          .map((event) => [event.stage, event.outcome, event.status, event.method, event.originType]),
        [
          ["origin", "primary_failed", 503, "GET", "upstreamWithFallback"],
          ["origin", "fallback_completed", 200, "GET", "upstreamWithFallback"],
        ],
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url origin logs structured request failure details", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    await withCapturedConsole(async (logs) => {
      const response = await url(new Request("https://gateway.example.com/orders", {
        headers: {
          authorization: "Bearer secret-token",
          "x-device-id": "device-456",
          "x-license-key": "secret-license-key",
        },
      }), {
        url: "https://origin.example.com/orders",
      }, originContext);

      assert.equal(response.status, 502);
      assert.deepEqual(
        logs.error.map((event) => [event.stage, event.outcome, event.method, event.originType]),
        [["origin", "request_failed", "GET", "url"]],
      );
      for (const event of logs.error) {
        assert.equal("path" in event, false);
        assert.equal("query" in event, false);
        assert.equal("params" in event, false);
        assert.equal("headers" in event, false);
        assert.equal("targetUrl" in event, false);
        assert.equal("errorMessage" in event, false);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url origin aborts timed out requests without following redirects", async () => {
  const originalFetch = globalThis.fetch;
  let redirect: RequestInit["redirect"];
  let signal: AbortSignal | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const request = input as Request;
    redirect = request.redirect;
    signal = request.signal;

    if (!signal) {
      return new Response(null, { status: 302 });
    }

    return new Promise<Response>((_resolve, reject) => {
      const testTimeout = setTimeout(() => reject(new Error("test timeout")), 25);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(testTimeout);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }) as typeof fetch;

  try {
    const response = await url(
      new Request("https://gateway.example.com/orders"),
      { url: "https://origin.example.com/orders", timeout: 5 },
      originContext,
    );

    assert.equal(response.status, 504);
    assert.equal(redirect, "manual");
    assert.equal(signal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url origin preserves the incoming query string for fixed upstream paths", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    await withCapturedConsole(async (logs) => {
      const response = await url(
        new Request(
          "https://gateway.example.com/udemy/v2?key=abc&device=xyz",
        ),
        {
          url: "https://origin.example.com/cookies",
          pathRewrite: "/udemy/v2",
        },
        originContext,
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        logs.info.map((event) => [event.stage, event.outcome, event.status, event.method, event.originType]),
        [],
      );
    });
    assert.equal(
      capturedUrl,
      "https://origin.example.com/cookies?key=abc&device=xyz",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url origin applies pathRewrite when forwarding to a root upstream URL", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    const response = await url(
      new Request(
        "https://gateway.example.com/udemy/v2/api/public/udemy-base-url?key=abc",
      ),
      {
        url: "https://origin.example.com",
        pathRewrite: "/udemy/v2",
      },
      originContext,
    );

    assert.equal(response.status, 200);
    assert.equal(
      capturedUrl,
      "https://origin.example.com/api/public/udemy-base-url?key=abc",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url origin strips prefixes only at a path segment boundary", async () => {
  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrls.push((input as Request).url);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    const options = { url: "https://origin.example.com", stripPrefix: "/udemy/v3" };
    await url(new Request("https://gateway.example.com/udemy/v3/a"), options, originContext);
    await url(new Request("https://gateway.example.com/udemy/v3x/a"), options, originContext);

    assert.deepEqual(capturedUrls, [
      "https://origin.example.com/a",
      "https://origin.example.com/",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url origin rewrites upstream redirects through the gateway", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "https://origin.example.com/login?next=1" },
    })) as typeof fetch;

  try {
    const response = await url(
      new Request("https://gateway.example.com/app/orders"),
      { url: "https://origin.example.com", stripPrefix: "/app" },
      originContext,
    );

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("Location"),
      "https://gateway.example.com/app/login?next=1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
