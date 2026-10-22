import {
  getClient as createConfigCatClient,
  PollingMode,
} from "@configcat/sdk";
import type { IConfigCatClient } from "@configcat/sdk";

import {
  createConfigCatCache,
  readLkg,
  writeLkg,
  type GatewayConfigEnv,
} from "./kv";
import { validateGatewayConfig } from "./schema";
import { compileGateway } from "../gateway/compiler";
import { emitGatewayLog } from "../gateway/logging";
import { errorMessage } from "../helpers/errors";
import type {
  CompiledGateway,
  GatewayEnv,
  GatewayExecutionContext,
  GatewayHandlers,
  GatewayLogger,
} from "../gateway/types";

const FLAG_KEY = "gateway_config";
const SENTINEL = "__gateway_config_configcat_sentinel__";
const REFRESH_INTERVAL_MS = 60_000;
const FAILURE_BACKOFF_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

export type ResolverEnv = GatewayEnv & GatewayConfigEnv;

type CandidateName = "configcat" | "lkg" | "inline-refresh" | "bundled";

type Candidate = {
  compiled: CompiledGateway;
  raw: string;
  source: CandidateName;
};

export type ResolveGatewayDependencies = {
  now?: () => number;
  logEvent?: GatewayLogger;
  getClient?: (env: ResolverEnv) => IConfigCatClient;
  finalCandidate?: unknown;
};

const getNow = (dependencies: ResolveGatewayDependencies): number =>
  dependencies.now ? dependencies.now() : Date.now();

const hashDocument = (raw: string): string => {
  let hash = 2166136261;

  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.codePointAt(index) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

const logCandidateFailure = (
  dependencies: ResolveGatewayDependencies,
  source: CandidateName,
  reason: string,
): void => {
  emitGatewayLog(dependencies.logEvent, {
    level: "error",
    stage: "config_resolution",
    outcome: "candidate_rejected",
    configSource: source,
    reason,
  });
};

const logAdoption = (
  dependencies: ResolveGatewayDependencies,
  candidate: Candidate,
): void => {
  emitGatewayLog(dependencies.logEvent, {
    level: "info",
    stage: "config_resolution",
    outcome: "candidate_adopted",
    configSource: candidate.source,
    configHash: hashDocument(candidate.raw),
  });
};

const parseCandidate = (value: unknown): { parsed: unknown; raw: string } => {
  if (typeof value === "string") {
    return { parsed: JSON.parse(value), raw: value };
  }

  const raw = JSON.stringify(value);
  if (raw === undefined) {
    throw new Error("Candidate cannot be serialized as JSON");
  }

  return { parsed: value, raw };
};

const tryCandidate = (
  source: CandidateName,
  value: unknown,
  handlers: GatewayHandlers,
  dependencies: ResolveGatewayDependencies,
): Candidate | undefined => {
  try {
    const { parsed, raw } = parseCandidate(value);
    const validation = validateGatewayConfig(parsed);
    if (!validation.valid) {
      const reason = validation.errors.map((error) => error.error).join("; ");
      throw new Error(reason || "Configuration shape is invalid");
    }

    return {
      compiled: compileGateway(validation.config, handlers),
      raw,
      source,
    };
  } catch (error) {
    logCandidateFailure(dependencies, source, errorMessage(error));
    return undefined;
  }
};

const readFlag = async (
  client: IConfigCatClient,
): Promise<{ raw: string; fetchTime?: Date }> => {
  const refresh = await client.forceRefreshAsync();
  if (!refresh.isSuccess) {
    throw new Error(refresh.errorMessage || "ConfigCat refresh failed");
  }

  const details = await client.getValueDetailsAsync(FLAG_KEY, SENTINEL);
  if (details.isDefaultValue || details.value === SENTINEL) {
    throw new Error("ConfigCat returned no value");
  }

  return { raw: details.value, fetchTime: details.fetchTime };
};

const withLogLevel = (
  env: ResolverEnv,
  dependencies: ResolveGatewayDependencies,
): ResolveGatewayDependencies => ({
  ...dependencies,
  logEvent: (event) => emitGatewayLog(dependencies.logEvent, event, env),
});

// Request isolates only read the last-known-good document. The scheduled
// handler is the single writer: it polls ConfigCat and stores changes in KV.
export const createGatewayResolver = () => {
  let client: IConfigCatClient | undefined;
  let compiled: CompiledGateway | undefined;
  let currentRaw: string | undefined;
  let nextRefreshMs = 0;
  let coldResolve: Promise<void> | undefined;

  const getClient = (
    env: ResolverEnv,
    dependencies: ResolveGatewayDependencies,
  ): IConfigCatClient => {
    if (client) {
      return client;
    }

    if (dependencies.getClient) {
      client = dependencies.getClient(env);
    } else {
      if (!env.CONFIGCAT_SDK_KEY) {
        throw new Error("CONFIGCAT_SDK_KEY is required to create the ConfigCat client");
      }

      client = createConfigCatClient(
        env.CONFIGCAT_SDK_KEY,
        PollingMode.ManualPoll,
        {
          cache: createConfigCatCache(env, dependencies.logEvent),
          requestTimeoutMs: REQUEST_TIMEOUT_MS,
        },
      );
    }

    return client;
  };

  const adopt = (
    candidate: Candidate,
    dependencies: ResolveGatewayDependencies,
  ): void => {
    compiled = candidate.compiled;
    currentRaw = candidate.raw;
    logAdoption(dependencies, candidate);
  };

  const getInlineRefreshCandidate = async (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies,
  ): Promise<Candidate | undefined> => {
    try {
      const { raw } = await readFlag(getClient(env, dependencies));
      return tryCandidate("inline-refresh", raw, handlers, dependencies);
    } catch (error) {
      logCandidateFailure(dependencies, "inline-refresh", errorMessage(error));
      return undefined;
    }
  };

  const resolveCold = async (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies,
  ): Promise<void> => {
    const lkg = await readLkg(env, dependencies.logEvent);
    let candidate: Candidate | undefined;
    if (lkg) {
      candidate = tryCandidate("lkg", lkg.raw, handlers, dependencies);
    } else {
      logCandidateFailure(dependencies, "lkg", "No last-known-good document");
    }

    candidate ??= await getInlineRefreshCandidate(env, handlers, dependencies);

    if (!candidate) {
      if (dependencies.finalCandidate === undefined) {
        logCandidateFailure(dependencies, "bundled", "No final candidate");
      } else {
        candidate = tryCandidate(
          "bundled",
          dependencies.finalCandidate,
          handlers,
          dependencies,
        );
      }
    }

    if (!candidate) {
      nextRefreshMs = getNow(dependencies) + FAILURE_BACKOFF_MS;
      return;
    }

    adopt(candidate, dependencies);
    nextRefreshMs = getNow(dependencies) + REFRESH_INTERVAL_MS;
  };

  const refreshFromLkg = async (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies,
  ): Promise<void> => {
    const lkg = await readLkg(env, dependencies.logEvent);
    if (!lkg || lkg.raw === currentRaw) {
      return;
    }

    const candidate = tryCandidate("lkg", lkg.raw, handlers, dependencies);
    if (candidate) {
      adopt(candidate, dependencies);
    }
  };

  const resolve = async (
    env: ResolverEnv,
    ctx: GatewayExecutionContext,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies = {},
  ): Promise<CompiledGateway | undefined> => {
    dependencies = withLogLevel(env, dependencies);
    const now = getNow(dependencies);

    if (compiled) {
      if (now >= nextRefreshMs) {
        nextRefreshMs = now + REFRESH_INTERVAL_MS;
        ctx.waitUntil(refreshFromLkg(env, handlers, dependencies));
      }
      return compiled;
    }

    if (!coldResolve) {
      if (now < nextRefreshMs) {
        return undefined;
      }

      coldResolve = resolveCold(env, handlers, dependencies).finally(() => {
        coldResolve = undefined;
      });
    }

    await coldResolve;
    return compiled;
  };

  // Called by the scheduled handler. Polls ConfigCat, adopts a changed
  // document, and stores it as the last-known-good document.
  const refresh = async (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies = {},
  ): Promise<boolean> => {
    dependencies = withLogLevel(env, dependencies);

    let flag: { raw: string; fetchTime?: Date };
    try {
      flag = await readFlag(getClient(env, dependencies));
    } catch (error) {
      logCandidateFailure(dependencies, "configcat", errorMessage(error));
      return false;
    }

    if (flag.raw !== currentRaw) {
      const candidate = tryCandidate("configcat", flag.raw, handlers, dependencies);
      if (!candidate) {
        return false;
      }
      adopt(candidate, dependencies);
    }

    await writeLkg(env, flag.raw, flag.fetchTime, dependencies.logEvent);
    return true;
  };

  return { resolve, refresh };
};
