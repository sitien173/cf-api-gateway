import test from "node:test";
import assert from "node:assert/strict";
import type { IConfigCatClient } from "@configcat/sdk";

import {
  createGatewayResolver,
  type ResolveGatewayDependencies,
} from "../src/config/source.ts";
import { getLkgKey } from "../src/config/kv.ts";

const validRaw = JSON.stringify({
  origins: { public: { type: "url", options: { url: "https://origin.test" } } },
  policies: {},
  routes: [{ path: "/public", methods: ["GET"], origin: "public" }],
});

const refreshedRaw = JSON.stringify({
  origins: { public: { type: "url", options: { url: "https://origin.test" } } },
  policies: {},
  routes: [{ path: "/refreshed", methods: ["GET"], origin: "public" }],
});

const handlers = {
  requestPolicies: {},
  responsePolicies: {},
  origins: { url: async () => new Response("ok") },
};

type FakeKv = {
  values: Map<string, string>;
  getCalls: number;
  putCalls: number;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

const createKv = (): FakeKv => {
  const values = new Map<string, string>();
  return {
    values,
    getCalls: 0,
    putCalls: 0,
    async get(key) {
      this.getCalls += 1;
      return values.get(key) ?? null;
    },
    async put(key, value) {
      this.putCalls += 1;
      values.set(key, value);
    },
  };
};

const createEnv = (kv: FakeKv) => ({
  GATEWAY_NAME: "gateway-a",
  GATEWAY_CONFIG: kv as unknown as KVNamespace,
  CONFIGCAT_SDK_KEY: "sdk-key",
});

const createContext = () => {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(Promise.resolve(promise));
      },
      passThroughOnException() {},
    } as ExecutionContext,
    async flush() {
      await Promise.all(pending.splice(0));
    },
    pending,
  };
};

const createClient = (value: string | undefined) => {
  let currentValue = value;
  let forceRefreshCalls = 0;
  let detailsCalls = 0;
  let forceRefresh: () => Promise<{ isSuccess: boolean }> = async () => ({
    isSuccess: true,
  });

  return {
    get forceRefreshCalls() {
      return forceRefreshCalls;
    },
    get detailsCalls() {
      return detailsCalls;
    },
    setValue(nextValue: string | undefined) {
      currentValue = nextValue;
    },
    setForceRefresh(next: () => Promise<{ isSuccess: boolean }>) {
      forceRefresh = next;
    },
    async getValueDetailsAsync(_key: string, defaultValue: string) {
      detailsCalls += 1;
      return {
        value: currentValue ?? defaultValue,
        isDefaultValue: currentValue === undefined,
        fetchTime: currentValue === undefined ? undefined : new Date(100),
      };
    },
    async forceRefreshAsync() {
      forceRefreshCalls += 1;
      return forceRefresh();
    },
  };
};

const resolverDependencies = (
  client: ReturnType<typeof createClient>,
  overrides: Partial<ResolveGatewayDependencies> = {},
): ResolveGatewayDependencies => ({
  getClient: () => client as unknown as IConfigCatClient,
  now: () => 1000,
  ...overrides,
});

const storeLkg = (kv: FakeKv, raw: string, timestamp = 100) => {
  kv.values.set(
    getLkgKey({ GATEWAY_NAME: "gateway-a" }),
    JSON.stringify({ version: 1, raw, timestamp }),
  );
};

const adoptedSources = (logs: Array<{ outcome: string; configSource?: string }>) =>
  logs
    .filter((event) => event.outcome === "candidate_adopted")
    .map((event) => event.configSource);

test("cold request adopts a valid lkg without contacting ConfigCat or writing KV", async () => {
  const kv = createKv();
  storeLkg(kv, validRaw);
  const client = createClient(refreshedRaw);
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const resolver = createGatewayResolver();

  const gateway = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(client, { logEvent: (event) => logs.push(event) }),
  );

  assert.ok(gateway);
  assert.deepEqual(adoptedSources(logs), ["lkg"]);
  assert.equal(client.forceRefreshCalls, 0);
  assert.equal(client.detailsCalls, 0);
  assert.equal(kv.putCalls, 0);
});

test("warm requests inside the refresh interval perform no I/O", async () => {
  const kv = createKv();
  storeLkg(kv, validRaw);
  const context = createContext();
  let now = 1000;
  const dependencies = resolverDependencies(createClient(undefined), { now: () => now });
  const resolver = createGatewayResolver();

  const first = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  const getCalls = kv.getCalls;
  now = 60_999;
  const second = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);

  assert.ok(first);
  assert.strictEqual(second, first);
  assert.equal(kv.getCalls, getCalls);
  assert.equal(context.pending.length, 0);
});

test("warm refresh reads lkg in the background and adopts a changed document", async () => {
  const kv = createKv();
  storeLkg(kv, validRaw);
  const context = createContext();
  let now = 1000;
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const dependencies = resolverDependencies(createClient(undefined), {
    now: () => now,
    logEvent: (event) => logs.push(event),
  });
  const resolver = createGatewayResolver();

  const first = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  storeLkg(kv, refreshedRaw, 200);
  now = 61_000;
  const stale = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  const sameInterval = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);

  assert.strictEqual(stale, first);
  assert.strictEqual(sameInterval, first);
  assert.equal(context.pending.length, 1);

  await context.flush();
  const refreshed = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);

  assert.ok(refreshed);
  assert.notStrictEqual(refreshed, first);
  assert.deepEqual(adoptedSources(logs), ["lkg", "lkg"]);
  assert.equal(kv.putCalls, 0);
});

test("warm refresh keeps the compiled gateway when lkg is unchanged", async () => {
  const kv = createKv();
  storeLkg(kv, validRaw);
  const context = createContext();
  let now = 1000;
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const dependencies = resolverDependencies(createClient(undefined), {
    now: () => now,
    logEvent: (event) => logs.push(event),
  });
  const resolver = createGatewayResolver();

  const first = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  now = 61_000;
  await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  await context.flush();
  const second = await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);

  assert.strictEqual(second, first);
  assert.deepEqual(adoptedSources(logs), ["lkg"]);
});

test("cold request falls through a corrupt lkg to one inline refresh without writing lkg", async () => {
  const kv = createKv();
  kv.values.set(getLkgKey({ GATEWAY_NAME: "gateway-a" }), "{not-json");
  const client = createClient(validRaw);
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const resolver = createGatewayResolver();

  const gateway = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(client, { logEvent: (event) => logs.push(event) }),
  );

  assert.ok(gateway);
  assert.deepEqual(adoptedSources(logs), ["inline-refresh"]);
  assert.equal(client.forceRefreshCalls, 1);
  assert.equal(kv.putCalls, 0);
});

test("cold request adopts the bundled candidate when lkg and ConfigCat fail", async () => {
  const kv = createKv();
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const resolver = createGatewayResolver();

  const gateway = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(createClient(undefined), {
      finalCandidate: JSON.parse(validRaw),
      logEvent: (event) => logs.push(event),
    }),
  );

  assert.ok(gateway);
  assert.deepEqual(adoptedSources(logs), ["bundled"]);
  assert.equal(kv.putCalls, 0);
});

test("concurrent cold requests share one candidate ladder", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  const context = createContext();
  const dependencies = resolverDependencies(client);
  const resolver = createGatewayResolver();

  const [first, second] = await Promise.all([
    resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies),
    resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies),
  ]);

  assert.ok(first);
  assert.strictEqual(second, first);
  assert.equal(kv.getCalls, 1);
  assert.equal(client.forceRefreshCalls, 1);
});

test("returns undefined when every candidate fails and backs off retries for five seconds", async () => {
  const kv = createKv();
  let now = 1000;
  const dependencies = resolverDependencies(createClient(undefined), { now: () => now });
  const resolver = createGatewayResolver();

  assert.equal(await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies), undefined);
  const getCalls = kv.getCalls;

  now = 5999;
  assert.equal(await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies), undefined);
  assert.equal(kv.getCalls, getCalls);

  now = 6000;
  storeLkg(kv, validRaw);
  assert.ok(await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies));
  assert.equal(kv.getCalls, getCalls + 1);
});

test("logs the adopted candidate and a deterministic document hash", async () => {
  const kv = createKv();
  storeLkg(kv, validRaw);
  const logs: Array<{ source?: string; hash?: string }> = [];
  const resolver = createGatewayResolver();

  await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(createClient(undefined), {
      logEvent: (event) => {
        if (event.outcome === "candidate_adopted") {
          logs.push({ source: event.configSource, hash: event.configHash });
        }
      },
    }),
  );

  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, "lkg");
  assert.match(logs[0].hash ?? "", /^[0-9a-f]+$/);
});

test("scheduled refresh adopts a ConfigCat document and stores it as lkg", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  const resolver = createGatewayResolver();
  const dependencies = resolverDependencies(client);

  assert.equal(await resolver.refresh(createEnv(kv), handlers, dependencies), true);
  const gateway = await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies);

  assert.ok(gateway);
  assert.equal(client.forceRefreshCalls, 1);
  assert.equal(kv.putCalls, 1);
  assert.deepEqual(JSON.parse(kv.values.get(getLkgKey({ GATEWAY_NAME: "gateway-a" }))!), {
    version: 1,
    raw: validRaw,
    timestamp: 100,
  });
});

test("scheduled refresh with an unchanged document neither recompiles nor writes", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const resolver = createGatewayResolver();
  const dependencies = resolverDependencies(client, { logEvent: (event) => logs.push(event) });

  await resolver.refresh(createEnv(kv), handlers, dependencies);
  assert.equal(await resolver.refresh(createEnv(kv), handlers, dependencies), true);

  assert.deepEqual(adoptedSources(logs), ["configcat"]);
  assert.equal(kv.putCalls, 1);
});

test("scheduled refresh stores lkg for a document first adopted from inline refresh", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  const resolver = createGatewayResolver();
  const dependencies = resolverDependencies(client);

  await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies);
  assert.equal(kv.putCalls, 0);
  await resolver.refresh(createEnv(kv), handlers, dependencies);

  assert.equal(kv.putCalls, 1);
});

test("scheduled refresh rejects an invalid document and keeps the active gateway", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  const resolver = createGatewayResolver();
  const dependencies = resolverDependencies(client);

  await resolver.refresh(createEnv(kv), handlers, dependencies);
  const active = await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies);
  client.setValue("{not-json");

  assert.equal(await resolver.refresh(createEnv(kv), handlers, dependencies), false);
  assert.strictEqual(
    await resolver.resolve(createEnv(kv), createContext().ctx, handlers, dependencies),
    active,
  );
  assert.equal(kv.putCalls, 1);
});

test("scheduled refresh logs a ConfigCat failure without adopting or writing", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  client.setForceRefresh(async () => ({ isSuccess: false }));
  const logs: Array<{ outcome: string; configSource?: string }> = [];
  const resolver = createGatewayResolver();

  const refreshed = await resolver.refresh(
    createEnv(kv),
    handlers,
    resolverDependencies(client, { logEvent: (event) => logs.push(event) }),
  );

  assert.equal(refreshed, false);
  assert.deepEqual(
    logs.map((event) => [event.outcome, event.configSource]),
    [["candidate_rejected", "configcat"]],
  );
  assert.equal(kv.putCalls, 0);
});
