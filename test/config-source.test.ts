import test from "node:test";
import assert from "node:assert/strict";

import {
  createGatewayResolver,
  type ResolveGatewayDependencies,
} from "../src/config/source.ts";

const validRaw = JSON.stringify({
  routes: [
    {
      path: "/public",
      method: "GET",
      origin: { type: "url" },
      policies: { request: [], response: [] },
    },
  ],
  policies: [],
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
  getClient: () => client,
  now: () => 1000,
  random: () => 0,
  ...overrides,
});

test("serves a warm compiled gateway without performing I/O", async () => {
  const kv = createKv();
  const env = createEnv(kv);
  const context = createContext();
  const client = createClient(validRaw);
  let now = 1000;
  const dependencies = resolverDependencies(client, { now: () => now });
  const resolver = createGatewayResolver();

  const first = await resolver.resolve(env, context.ctx, handlers, dependencies);
  now = 2000;
  const second = await resolver.resolve(env, context.ctx, handlers, dependencies);

  assert.ok(first);
  assert.strictEqual(second, first);
  assert.equal(client.detailsCalls, 1);
  assert.equal(client.forceRefreshCalls, 0);
  assert.equal(kv.getCalls, 0);
  assert.equal(kv.putCalls, 0);
  assert.equal(context.pending.length, 0);
});

test("falls through a malformed ConfigCat value to a valid lkg", async () => {
  const kv = createKv();
  kv.values.set(
    "lkg:gateway-a:gateway_config",
    JSON.stringify({ version: 1, raw: validRaw, timestamp: 100 }),
  );
  const client = createClient("not-json");
  const adopted: string[] = [];
  const resolver = createGatewayResolver();

  const result = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(client, {
      logEvent: (event) => {
        if (event.outcome === "candidate_adopted" && event.configSource) {
          adopted.push(event.configSource);
        }
      },
    }),
  );

  assert.ok(result);
  assert.deepEqual(adopted, ["lkg"]);
  assert.equal(client.forceRefreshCalls, 0);
  assert.equal(kv.putCalls, 0);
});

test("falls through a corrupt lkg to one inline refresh and writes fresh lkg", async () => {
  const kv = createKv();
  kv.values.set("lkg:gateway-a:gateway_config", "{corrupt");
  const client = createClient(undefined);
  client.setForceRefresh(async () => {
    client.setValue(validRaw);
    return { isSuccess: true };
  });
  const adopted: string[] = [];
  const resolver = createGatewayResolver();

  const result = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(client, {
      logEvent: (event) => {
        if (event.outcome === "candidate_adopted" && event.configSource) {
          adopted.push(event.configSource);
        }
      },
    }),
  );

  assert.ok(result);
  assert.deepEqual(adopted, ["inline-refresh"]);
  assert.equal(client.forceRefreshCalls, 1);
  assert.equal(kv.putCalls, 1);
});

test("concurrent cold requests share one candidate ladder and refresh", async () => {
  const kv = createKv();
  const client = createClient(undefined);
  let releaseRefresh!: () => void;
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  client.setForceRefresh(async () => {
    await refreshReleased;
    client.setValue(validRaw);
    return { isSuccess: true };
  });
  const resolver = createGatewayResolver();
  const context = createContext();
  const dependencies = resolverDependencies(client);

  const first = resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
  const second = resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);

  assert.equal(client.forceRefreshCalls, 1);
  releaseRefresh();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.ok(firstResult);
  assert.strictEqual(secondResult, firstResult);
});

test("failed background refresh uses a five-second retry window", async () => {
  const kv = createKv();
  const client = createClient(validRaw);
  client.setForceRefresh(async () => ({ isSuccess: false }));
  let now = 1000;
  const context = createContext();
  const dependencies = resolverDependencies(client, { now: () => now });
  const resolver = createGatewayResolver();

  await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  now = 61000;
  await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  await context.flush();
  assert.equal(client.forceRefreshCalls, 1);

  now = 65999;
  await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  assert.equal(client.forceRefreshCalls, 1);
  now = 66001;
  await resolver.resolve(createEnv(kv), context.ctx, handlers, dependencies);
  await context.flush();
  assert.equal(client.forceRefreshCalls, 2);
});

test("does not write lkg for a KV or bundled candidate", async () => {
  const kv = createKv();
  kv.values.set(
    "lkg:gateway-a:gateway_config",
    JSON.stringify({ version: 1, raw: validRaw, timestamp: 100 }),
  );
  const client = createClient(undefined);
  const resolver = createGatewayResolver();
  const result = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(client, { finalCandidate: JSON.parse(validRaw) }),
  );

  assert.ok(result);
  assert.equal(kv.putCalls, 0);
});

test("returns undefined when every candidate fails", async () => {
  const kv = createKv();
  const client = createClient("not-json");
  client.setForceRefresh(async () => ({ isSuccess: false }));
  const resolver = createGatewayResolver();

  const result = await resolver.resolve(
    createEnv(kv),
    createContext().ctx,
    handlers,
    resolverDependencies(client, { finalCandidate: "also-not-json" }),
  );

  assert.equal(result, undefined);
});

test("logs the adopted candidate and a deterministic document hash", async () => {
  const client = createClient(validRaw);
  const logs: Array<{ source?: string; hash?: string }> = [];
  const resolver = createGatewayResolver();

  await resolver.resolve(
    createEnv(createKv()),
    createContext().ctx,
    handlers,
    resolverDependencies(client, {
      logEvent: (event) => logs.push({ source: event.configSource, hash: event.configHash }),
    }),
  );

  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, "configcat");
  assert.match(logs[0].hash ?? "", /^[0-9a-f]+$/);
});

test("jitter stays within the configured refresh bounds", async () => {
  const client = createClient(validRaw);
  let now = 1000;
  let random = 1;
  const resolver = createGatewayResolver();
  const context = createContext();
  const dependencies = resolverDependencies(client, {
    now: () => now,
    random: () => random,
  });

  await resolver.resolve(createEnv(createKv()), context.ctx, handlers, dependencies);
  now = 75999;
  await resolver.resolve(createEnv(createKv()), context.ctx, handlers, dependencies);
  assert.equal(client.forceRefreshCalls, 0);
  now = 76000;
  await resolver.resolve(createEnv(createKv()), context.ctx, handlers, dependencies);
  await context.flush();
  assert.equal(client.forceRefreshCalls, 1);
});
