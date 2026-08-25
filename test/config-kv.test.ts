import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfigCatCache,
  getConfigCatCacheKey,
  getLkgKey,
  readLkg,
  writeLkg,
  type GatewayConfigEnv,
} from "../src/config/kv.ts";

type FakeKv = {
  values: Map<string, string>;
  get: (key: string, options?: unknown) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
};

const createFakeKv = (): FakeKv => {
  const values = new Map<string, string>();
  return {
    values,
    async get(key, _options) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
  };
};

const createEnv = (gatewayName: string | undefined, kv: FakeKv): GatewayConfigEnv => ({
  GATEWAY_NAME: gatewayName,
  GATEWAY_CONFIG: kv as unknown as KVNamespace,
});

test("requires GATEWAY_NAME and scopes both key prefixes", () => {
  assert.throws(
    () => getConfigCatCacheKey(createEnv(undefined, createFakeKv()), "sdk-key"),
    /GATEWAY_NAME/,
  );
  assert.throws(
    () => getLkgKey(createEnv("", createFakeKv())),
    /GATEWAY_NAME/,
  );

  const first = createEnv("gateway-a", createFakeKv());
  const second = createEnv("gateway-b", createFakeKv());
  assert.equal(getConfigCatCacheKey(first, "sdk-key"), "cc:gateway-a:sdk-key");
  assert.equal(getLkgKey(first), "lkg:gateway-a:gateway_config");
  assert.notEqual(getConfigCatCacheKey(first, "sdk-key"), getConfigCatCacheKey(second, "sdk-key"));
  assert.notEqual(getLkgKey(first), getLkgKey(second));
});

test("ConfigCat cache scopes SDK keys and uses the KV cache TTL", async () => {
  const kv = createFakeKv();
  const env = createEnv("gateway-a", kv);
  const cache = createConfigCatCache(env);
  const getCalls: Array<{ key: string; options: unknown }> = [];
  const originalGet = kv.get;
  kv.get = async (key, options) => {
    getCalls.push({ key, options });
    return originalGet(key, options);
  };

  await cache.set("sdk-key", "cached config");
  assert.equal(await cache.get("sdk-key"), "cached config");
  assert.deepEqual(getCalls, [
    { key: "cc:gateway-a:sdk-key", options: { cacheTtl: 60 } },
  ]);
});

test("ConfigCat cache skips byte-identical writes per key", async () => {
  const kv = createFakeKv();
  const env = createEnv("gateway-a", kv);
  const cache = createConfigCatCache(env);
  let putCalls = 0;
  const originalPut = kv.put;
  kv.put = async (key, value) => {
    putCalls += 1;
    await originalPut(key, value);
  };

  await cache.set("sdk-key", "same");
  await cache.set("sdk-key", "same");
  await cache.set("other-key", "same");
  await cache.set("sdk-key", "different");

  assert.equal(putCalls, 3);
});

test("readLkg uses the KV cache TTL", async () => {
  const kv = createFakeKv();
  const env = createEnv("gateway-a", kv);
  let options: unknown;
  const originalGet = kv.get;
  kv.get = async (key, getOptions) => {
    options = getOptions;
    return originalGet(key, getOptions);
  };

  await readLkg(env);

  assert.deepEqual(options, { cacheTtl: 60 });
});

test("readLkg handles missing, legacy, and corrupt values", async () => {
  const kv = createFakeKv();
  const env = createEnv("gateway-a", kv);

  assert.equal(await readLkg(env), null);

  kv.values.set(getLkgKey(env), "legacy document");
  assert.deepEqual(await readLkg(env), {
    version: 1,
    raw: "legacy document",
    timestamp: 0,
  });

  kv.values.set(getLkgKey(env), "{not-json");
  assert.deepEqual(await readLkg(env), {
    version: 1,
    raw: "{not-json",
    timestamp: 0,
  });
});

test("writeLkg stores a versioned raw document and timestamp", async () => {
  const kv = createFakeKv();
  const env = createEnv("gateway-a", kv);
  const timestamp = new Date("2026-01-02T03:04:05.000Z");

  assert.equal(await writeLkg(env, "gateway document", timestamp), true);
  assert.deepEqual(JSON.parse(kv.values.get(getLkgKey(env))!), {
    version: 1,
    raw: "gateway document",
    timestamp: timestamp.getTime(),
  });
});

test("writeLkg does not overwrite an equal or newer envelope", async () => {
  const kv = createFakeKv();
  const env = createEnv("gateway-a", kv);
  const key = getLkgKey(env);
  kv.values.set(key, JSON.stringify({
    version: 1,
    raw: "newer document",
    timestamp: 200,
  }));

  assert.equal(await writeLkg(env, "older document", 100), false);
  assert.equal(await writeLkg(env, "equal document", 200), false);
  assert.equal(JSON.parse(kv.values.get(key)!).raw, "newer document");
});

test("writeLkg catches a rejected KV write", async () => {
  const kv = createFakeKv();
  kv.put = async () => {
    throw new Error("KV unavailable");
  };

  const result = await writeLkg(createEnv("gateway-a", kv), "document", 100);

  assert.equal(result, false);
});
