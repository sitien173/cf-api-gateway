import type { IConfigCatCache } from "@configcat/sdk";

export type GatewayConfigEnv = {
  GATEWAY_NAME?: string;
  GATEWAY_CONFIG: KVNamespace;
};

export type LkgEnvelope = {
  version: 1;
  raw: string;
  timestamp: number;
};

type GatewayNameEnv = Pick<GatewayConfigEnv, "GATEWAY_NAME">;

const requireGatewayName = ({ GATEWAY_NAME }: GatewayNameEnv): string => {
  if (typeof GATEWAY_NAME !== "string" || GATEWAY_NAME.trim() === "") {
    throw new Error("GATEWAY_NAME is required to scope configuration keys");
  }

  return GATEWAY_NAME;
};

export const getConfigCatCacheKey = (
  env: GatewayNameEnv,
  sdkCacheKey: string,
): string => `cc:${requireGatewayName(env)}:${sdkCacheKey}`;

export const getLkgKey = (env: GatewayNameEnv): string =>
  `lkg:${requireGatewayName(env)}:gateway_config`;

const logKvError = (operation: string, error: unknown): void => {
  console.error(`[config] KV ${operation} failed`, error);
};

export class GatewayConfigCatCache implements IConfigCatCache {
  private readonly lastWritten = new Map<string, string>();

  constructor(private readonly env: GatewayConfigEnv) {}

  async get(key: string): Promise<string | null | undefined> {
    const scopedKey = getConfigCatCacheKey(this.env, key);

    try {
      return await this.env.GATEWAY_CONFIG.get(scopedKey, { cacheTtl: 60 });
    } catch (error) {
      logKvError("read", error);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const scopedKey = getConfigCatCacheKey(this.env, key);
    if (this.lastWritten.get(scopedKey) === value) {
      return;
    }

    try {
      await this.env.GATEWAY_CONFIG.put(scopedKey, value);
      this.lastWritten.set(scopedKey, value);
    } catch (error) {
      logKvError("write", error);
    }
  }
}

export const createConfigCatCache = (
  env: GatewayConfigEnv,
): IConfigCatCache => new GatewayConfigCatCache(env);

const asEnvelope = (stored: string): LkgEnvelope => {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 1 &&
      typeof (parsed as { raw?: unknown }).raw === "string" &&
      typeof (parsed as { timestamp?: unknown }).timestamp === "number" &&
      Number.isFinite((parsed as { timestamp: number }).timestamp)
    ) {
      return parsed as LkgEnvelope;
    }
  } catch {
    // Treat corrupt values as legacy raw documents.
  }

  return { version: 1, raw: stored, timestamp: 0 };
};

const toTimestamp = (value: Date | number | undefined): number | undefined => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const readLkg = async (
  env: GatewayConfigEnv,
): Promise<LkgEnvelope | null> => {
  const key = getLkgKey(env);

  try {
    const stored = await env.GATEWAY_CONFIG.get(key, { cacheTtl: 60 });
    return stored == null ? null : asEnvelope(stored);
  } catch (error) {
    logKvError("read", error);
    return null;
  }
};

export const writeLkg = async (
  env: GatewayConfigEnv,
  raw: string,
  configTimestamp: Date | number | undefined,
): Promise<boolean> => {
  const key = getLkgKey(env);
  const timestamp = toTimestamp(configTimestamp);
  if (timestamp === undefined) {
    return false;
  }

  try {
    // This read-then-write is not atomic; concurrent writers may race, and the newer timestamp guard is accepted here.
    const stored = await env.GATEWAY_CONFIG.get(key);
    if (stored != null && asEnvelope(stored).timestamp >= timestamp) {
      return false;
    }

    await env.GATEWAY_CONFIG.put(
      key,
      JSON.stringify({ version: 1, raw, timestamp } satisfies LkgEnvelope),
    );
    return true;
  } catch (error) {
    logKvError("write", error);
    return false;
  }
};
