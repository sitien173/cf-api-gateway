import test from "node:test";
import assert from "node:assert/strict";

import { proxyAll, upstreamWithFallback, url } from "../src/origins/index.ts";

type LoggedEvent = {
  stage?: string;
  outcome?: string;
  status?: number;
  targetUrl?: string;
  errorMessage?: string;
};

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

test("proxyAll logs primary failure and fallback completion with structured context", async () => {
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
      });

      assert.equal(response.status, 200);
      assert.deepEqual(
        logs.info
          .filter((event) =>
            event.outcome === "primary_failed" || event.outcome === "fallback_completed",
          )
          .map((event) => [event.stage, event.outcome, event.status, event.targetUrl]),
        [
          ["origin", "primary_failed", 503, `${primaryUrl}/orders?id=1`],
          ["origin", "fallback_completed", 200, `${fallbackUrl}/orders?id=1`],
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
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        logs.info
          .filter((event) =>
            event.outcome === "primary_failed" || event.outcome === "fallback_completed",
          )
          .map((event) => [event.stage, event.outcome, event.status, event.targetUrl]),
        [
          ["origin", "primary_failed", 503, `${primaryUrl}/orders?id=1`],
          ["origin", "fallback_completed", 200, `${fallbackUrl}/orders?id=1`],
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
      const response = await url(new Request("https://gateway.example.com/orders"), {
        url: "https://origin.example.com/orders",
      });

      assert.equal(response.status, 500);
      assert.deepEqual(
        logs.error.map((event) => [event.stage, event.outcome, event.errorMessage, event.targetUrl]),
        [["origin", "request_failed", "network down", "https://origin.example.com/orders"]],
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
