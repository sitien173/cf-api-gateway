import {
  getClient as createConfigCatClient,
  PollingMode,
} from "@configcat/sdk";
import type {
  EvaluationDetails,
  IConfigCatClient,
} from "@configcat/sdk";

import {
  createConfigCatCache,
  readLkg,
  writeLkg,
  type GatewayConfigEnv,
} from "./kv";
import { validateGatewayConfig } from "./schema";
import { compileGateway } from "../gateway/compiler";
import { emitGatewayLog } from "../gateway/logging";
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
const REFRESH_JITTER_MS = 15_000;
const FAILURE_BACKOFF_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

type ResolverEnv = GatewayConfigEnv &
  GatewayEnv & { CONFIGCAT_SDK_KEY?: string };

type CandidateName = "configcat" | "lkg" | "inline-refresh" | "bundled";

type Candidate = {
  compiled: CompiledGateway;
  raw: string;
  source: CandidateName;
  fetchTime?: Date;
};

type CandidateResult = Candidate | undefined;

type RefreshResult = {
  accepted: boolean;
  candidate?: Candidate;
};

export type ResolveGatewayDependencies = {
  now?: () => number;
  random?: () => number;
  logEvent?: GatewayLogger;
  getClient?: (env: ResolverEnv) => IConfigCatClient;
  finalCandidate?: unknown;
};

const getNow = (dependencies: ResolveGatewayDependencies): number =>
  dependencies.now ? dependencies.now() : Date.now();

const getJitter = (dependencies: ResolveGatewayDependencies): number => {
  const random = dependencies.random ? dependencies.random() : Math.random();
  const bounded = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
  return Math.floor(bounded * REFRESH_JITTER_MS);
};

const hashDocument = (raw: string): string => {
  let hash = 2166136261;

  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  fetchTime?: Date,
): CandidateResult => {
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
      fetchTime,
    };
  } catch (error) {
    logCandidateFailure(dependencies, source, errorMessage(error));
    return undefined;
  }
};

const isSentinel = (details: EvaluationDetails): boolean =>
  details.isDefaultValue || details.value === SENTINEL;

const getConfigCatCandidate = async (
  client: IConfigCatClient,
  source: CandidateName,
  handlers: GatewayHandlers,
  dependencies: ResolveGatewayDependencies,
): Promise<CandidateResult> => {
  try {
    const details = await client.getValueDetailsAsync(FLAG_KEY, SENTINEL);
    if (isSentinel(details)) {
      logCandidateFailure(dependencies, source, "ConfigCat returned no value");
      return undefined;
    }

    return tryCandidate(
      source,
      details.value,
      handlers,
      dependencies,
      details.fetchTime,
    );
  } catch (error) {
    logCandidateFailure(dependencies, source, errorMessage(error));
    return undefined;
  }
};

const getInlineRefreshCandidate = async (
  client: IConfigCatClient,
  handlers: GatewayHandlers,
  dependencies: ResolveGatewayDependencies,
): Promise<CandidateResult> => {
  try {
    const refresh = await client.forceRefreshAsync();
    if (!refresh.isSuccess) {
      throw new Error(refresh.errorMessage || "ConfigCat refresh failed");
    }

    const details = await client.getValueDetailsAsync(FLAG_KEY, SENTINEL);
    if (isSentinel(details)) {
      logCandidateFailure(dependencies, "inline-refresh", "ConfigCat returned no value");
      return undefined;
    }

    return tryCandidate(
      "inline-refresh",
      details.value,
      handlers,
      dependencies,
      details.fetchTime,
    );
  } catch (error) {
    logCandidateFailure(dependencies, "inline-refresh", errorMessage(error));
    return undefined;
  }
};

export const createGatewayResolver = () => {
  let client: IConfigCatClient | undefined;
  let compiled: CompiledGateway | undefined;
  let lastRaw: string | undefined;
  let nextRefreshMs = 0;
  let refreshInFlight: Promise<boolean> | undefined;
  let generation = 0;

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
          cache: createConfigCatCache(env),
          requestTimeoutMs: REQUEST_TIMEOUT_MS,
        },
      );
    }

    return client;
  };

  const adopt = (candidate: Candidate): void => {
    compiled = candidate.compiled;
    lastRaw = candidate.raw;
  };

  const resolveCold = async (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies,
  ): Promise<RefreshResult> => {
    let configCatClient: IConfigCatClient | undefined;
    try {
      configCatClient = getClient(env, dependencies);
    } catch (error) {
      logCandidateFailure(dependencies, "configcat", errorMessage(error));
    }

    if (configCatClient) {
      const configCat = await getConfigCatCandidate(
        configCatClient,
        "configcat",
        handlers,
        dependencies,
      );
      if (configCat) {
        return { accepted: true, candidate: configCat };
      }
    }

    try {
      const lkg = await readLkg(env);
      if (lkg) {
        const lkgCandidate = tryCandidate(
          "lkg",
          lkg.raw,
          handlers,
          dependencies,
        );
        if (lkgCandidate) {
          return { accepted: true, candidate: lkgCandidate };
        }
      } else {
        logCandidateFailure(dependencies, "lkg", "No last-known-good document");
      }
    } catch (error) {
      logCandidateFailure(dependencies, "lkg", errorMessage(error));
    }

    if (configCatClient) {
      const inlineRefresh = await getInlineRefreshCandidate(
        configCatClient,
        handlers,
        dependencies,
      );
      if (inlineRefresh) {
        return { accepted: true, candidate: inlineRefresh };
      }
    } else {
      logCandidateFailure(dependencies, "inline-refresh", "ConfigCat client unavailable");
    }

    if (dependencies.finalCandidate !== undefined) {
      const bundled = tryCandidate(
        "bundled",
        dependencies.finalCandidate,
        handlers,
        dependencies,
      );
      if (bundled) {
        return { accepted: true, candidate: bundled };
      }
    } else {
      logCandidateFailure(dependencies, "bundled", "No final candidate");
    }

    return { accepted: false };
  };

  const resolveRefresh = async (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies,
  ): Promise<RefreshResult> => {
    let configCatClient: IConfigCatClient;
    try {
      configCatClient = getClient(env, dependencies);
    } catch (error) {
      logCandidateFailure(dependencies, "inline-refresh", errorMessage(error));
      return { accepted: false };
    }

    const candidate = await getInlineRefreshCandidate(
      configCatClient,
      handlers,
      dependencies,
    );
    return candidate ? { accepted: true, candidate } : { accepted: false };
  };

  const startRefresh = (
    env: ResolverEnv,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies,
    cold: boolean,
  ): Promise<boolean> => {
    const capturedGeneration = ++generation;
    let refreshPromise!: Promise<boolean>;

    refreshPromise = (async () => {
      try {
        const result = cold
          ? await resolveCold(env, handlers, dependencies)
          : await resolveRefresh(env, handlers, dependencies);

        if (capturedGeneration !== generation) {
          return false;
        }

        if (!result.accepted || !result.candidate) {
          nextRefreshMs = getNow(dependencies) + FAILURE_BACKOFF_MS;
          return false;
        }

        adopt(result.candidate);
        logAdoption(dependencies, result.candidate);
        if (result.candidate.source === "inline-refresh") {
          await writeLkg(env, result.candidate.raw, result.candidate.fetchTime);
        }
        nextRefreshMs =
          getNow(dependencies) + REFRESH_INTERVAL_MS + getJitter(dependencies);
        return true;
      } catch (error) {
        logCandidateFailure(dependencies, cold ? "configcat" : "inline-refresh", errorMessage(error));
        if (capturedGeneration === generation) {
          nextRefreshMs = getNow(dependencies) + FAILURE_BACKOFF_MS;
        }
        return false;
      } finally {
        if (refreshInFlight === refreshPromise) {
          refreshInFlight = undefined;
        }
      }
    })();

    refreshInFlight = refreshPromise;
    return refreshPromise;
  };

  const resolve = async (
    env: ResolverEnv,
    ctx: GatewayExecutionContext,
    handlers: GatewayHandlers,
    dependencies: ResolveGatewayDependencies = {},
  ): Promise<CompiledGateway | undefined> => {
    const now = getNow(dependencies);
    if (compiled && now < nextRefreshMs) {
      return compiled;
    }

    if (refreshInFlight) {
      if (compiled) {
        return compiled;
      }

      await refreshInFlight;
      return compiled;
    }

    const hadCompiled = compiled !== undefined;
    const refresh = startRefresh(env, handlers, dependencies, !hadCompiled);
    if (hadCompiled) {
      ctx.waitUntil(refresh);
      return compiled;
    }

    await refresh;
    return compiled;
  };

  return { resolve };
};
