import test from "node:test";
import assert from "node:assert/strict";

import { proxyAll, upstreamWithFallback } from "../src/origins/index.ts";
import { executeFailover } from "../src/origins/failover.ts";

const mutationScenarios = [
  {
    name: "primary 5xx response",
    response: new Response("primary failed", { status: 503 }),
  },
  {
    name: "primary transport failure",
    response: undefined,
  },
];

test("proxyAll never replays mutation requests to fallback", async () => {
  for (const scenario of mutationScenarios) {
    const originalFetch = globalThis.fetch;
    const primaryUrl = `https://primary-proxyall-${scenario.name.replace(/\W/g, "-")}.example.com`;
    const fallbackUrl = `https://fallback-proxyall-${scenario.name.replace(/\W/g, "-")}.example.com`;
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      calls.push(request.url);

      if (request.url === `${primaryUrl}/api/health`) {
        return new Response("ok", { status: 200 });
      }

      if (request.url === `${primaryUrl}/orders`) {
        if (!scenario.response) {
          throw new Error("primary unavailable");
        }
        return scenario.response;
      }

      throw new Error(`unexpected fallback request: ${request.url}`);
    }) as typeof fetch;

    try {
      const response = await proxyAll(
        new Request("https://gateway.example.com/orders", {
          method: "POST",
          body: "mutation",
        }),
        {
          primaryUrl,
          fallbackUrl,
          healthCheckCacheTtl: 0,
        },
      );

      assert.equal(response.status, 503, scenario.name);
      assert.deepEqual(calls, [`${primaryUrl}/api/health`, `${primaryUrl}/orders`], scenario.name);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("health-check timers clear when health checks fail", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const handlers = [
    {
      name: "proxyall",
      run: proxyAll,
    },
    {
      name: "upstreamwithfallback",
      run: upstreamWithFallback,
    },
  ];

  try {
    for (const handler of handlers) {
      let scheduled = 0;
      let cleared = 0;
      const primaryUrl = `https://health-primary-${handler.name}.example.com`;
      const fallbackUrl = `https://health-fallback-${handler.name}.example.com`;
      const calls: string[] = [];

      globalThis.setTimeout = ((..._args: Parameters<typeof setTimeout>) => {
        scheduled += 1;
        return "timer" as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;
      globalThis.clearTimeout = ((_timer: ReturnType<typeof setTimeout>) => {
        cleared += 1;
      }) as typeof clearTimeout;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        calls.push(request.url);
        if (request.url === `${primaryUrl}/api/health`) {
          throw new Error("health unavailable");
        }
        if (request.url === `${fallbackUrl}/orders`) {
          return new Response("fallback", { status: 200 });
        }
        throw new Error(`unexpected request: ${request.url}`);
      }) as typeof fetch;

      const response = await handler.run(
        new Request("https://gateway.example.com/orders"),
        {
          primaryUrl,
          fallbackUrl,
          healthCheckCacheTtl: 0,
        },
      );

      assert.equal(response.status, 200, `${handler.name}: ${calls.join(", ")}`);
      assert.equal(scheduled, 1, handler.name);
      assert.equal(cleared, 1, handler.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("fallback requests use manual redirects after a primary transport failure", async () => {
  const originalFetch = globalThis.fetch;
  const handlers = [
    {
      name: "proxyall",
      run: proxyAll,
    },
    {
      name: "upstreamwithfallback",
      run: upstreamWithFallback,
    },
  ];

  try {
    for (const handler of handlers) {
      const primaryUrl = `https://redirect-primary-${handler.name}.example.com`;
      const fallbackUrl = `https://redirect-fallback-${handler.name}.example.com`;
      let fallbackRedirect: RequestRedirect | undefined;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        if (request.url === `${primaryUrl}/api/health`) {
          return new Response("ok", { status: 200 });
        }
        if (request.url === `${primaryUrl}/orders`) {
          throw new Error("primary unavailable");
        }
        if (request.url === `${fallbackUrl}/orders`) {
          fallbackRedirect = request.redirect;
          return new Response("fallback", { status: 200 });
        }
        throw new Error(`unexpected request: ${request.url}`);
      }) as typeof fetch;

      const response = await handler.run(
        new Request("https://gateway.example.com/orders"),
        {
          primaryUrl,
          fallbackUrl,
          healthCheckCacheTtl: 0,
        },
      );

      assert.equal(response.status, 200, handler.name);
      assert.equal(fallbackRedirect, "manual", handler.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET and HEAD retry once, while mutation methods preserve primary failures", async () => {
  const handlers = [
    { name: "proxyall", run: proxyAll },
    { name: "upstreamwithfallback", run: upstreamWithFallback },
  ];
  const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

  for (const handler of handlers) {
    for (const method of methods) {
      const originalFetch = globalThis.fetch;
      const primaryUrl = `https://method-primary-${handler.name}-${method.toLowerCase()}.example.com`;
      const fallbackUrl = `https://method-fallback-${handler.name}-${method.toLowerCase()}.example.com`;
      const requestUrls: string[] = [];

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        requestUrls.push(request.url);
        if (request.url === `${primaryUrl}/api/health`) {
          return new Response("ok", { status: 200 });
        }
        if (request.url === `${primaryUrl}/orders`) {
          return new Response("primary failed", { status: 503 });
        }
        if (request.url === `${fallbackUrl}/orders`) {
          return new Response("fallback", { status: 200 });
        }
        throw new Error(`unexpected request: ${request.url}`);
      }) as typeof fetch;

      try {
        const response = await handler.run(
          new Request("https://gateway.example.com/orders", {
            method,
            body: method === "GET" || method === "HEAD" ? undefined : "mutation",
          }),
          {
            primaryUrl,
            fallbackUrl,
            healthCheckCacheTtl: 0,
          },
        );

        const shouldRetry = method === "GET" || method === "HEAD";
        assert.equal(response.status, shouldRetry ? 200 : 503, `${handler.name} ${method}`);
        assert.equal(
          requestUrls.filter((url) => url === `${fallbackUrl}/orders`).length,
          shouldRetry ? 1 : 0,
          `${handler.name} ${method}`,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }
});

test("unhealthy primaries send mutations directly to fallback once", async () => {
  const handlers = [
    { name: "proxyall", run: proxyAll },
    { name: "upstreamwithfallback", run: upstreamWithFallback },
  ];

  for (const handler of handlers) {
    const originalFetch = globalThis.fetch;
    const primaryUrl = `https://unhealthy-primary-${handler.name}.example.com`;
    const fallbackUrl = `https://unhealthy-fallback-${handler.name}.example.com`;
    const requestUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requestUrls.push(request.url);
      if (request.url === `${primaryUrl}/api/health`) {
        return new Response("unhealthy", { status: 503 });
      }
      if (request.url === `${fallbackUrl}/orders`) {
        return new Response("fallback", { status: 201 });
      }
      throw new Error(`unexpected primary request: ${request.url}`);
    }) as typeof fetch;

    try {
      const response = await handler.run(
        new Request("https://gateway.example.com/orders", {
          method: "POST",
          body: "mutation",
        }),
        {
          primaryUrl,
          fallbackUrl,
          healthCheckCacheTtl: 0,
        },
      );

      assert.equal(response.status, 201, handler.name);
      assert.deepEqual(requestUrls, [`${primaryUrl}/api/health`, `${fallbackUrl}/orders`], handler.name);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("response rewrite errors do not trigger a fallback transport attempt", async () => {
  const originalFetch = globalThis.fetch;
  const primaryUrl = "https://rewrite-primary.example.com/orders";
  const fallbackUrl = "https://rewrite-fallback.example.com/orders";
  const requestUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input);
    requestUrls.push(request.url);
    return new Response("primary", { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      executeFailover({
        request: new Request("https://gateway.example.com/orders"),
        primaryUrl,
        fallbackUrl,
        primaryHealthy: true,
        wrapResponse: () => {
          throw new Error("rewrite failed");
        },
      }),
      /rewrite failed/,
    );
    assert.deepEqual(requestUrls, [primaryUrl]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
