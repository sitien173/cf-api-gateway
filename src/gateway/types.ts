import type {
  TOriginHandler,
  TRequestPolicyHandler,
  TResponsePolicyHandler,
} from "../types";

export type GatewayEnv = {
  AUTH0_ISSUER?: string;
  AUTH0_AUDIENCE?: string;
  GATEWAY_NAME?: string;
  ANALYTICS_ENABLED?: string;
  API_ANALYTICS?: AnalyticsEngineDataset;
  GATEWAY_LOG_LEVEL?: string;
  [key: string]: unknown;
};

export type OriginConfig = {
  type: string;
  options?: Record<string, unknown>;
  description?: string;
};

export type PolicyConfig = {
  type: string;
  options?: Record<string, unknown>;
  description?: string;
};

export type RouteConfig = {
  path: string;
  methods: string[];
  origin: string;
  request?: string[];
  response?: string[];
  auth?: "none";
  description?: string;
};

export type GatewayConfig = {
  origins: Record<string, OriginConfig>;
  policies: Record<string, PolicyConfig>;
  routes: RouteConfig[];
};

export type GatewayHandlers = {
  requestPolicies: Record<string, TRequestPolicyHandler>;
  responsePolicies: Record<string, TResponsePolicyHandler>;
  origins: Record<string, TOriginHandler>;
};

export type CompiledRequestPolicy = {
  name: string;
  options?: unknown;
  handler: TRequestPolicyHandler;
};

export type CompiledResponsePolicy = {
  name: string;
  options?: unknown;
  handler: TResponsePolicyHandler;
};

export type RouteMatchMode = "exact" | "prefix";

export type CompiledRoute = {
  path: string;
  method: string;
  originType: string;
  matchMode: RouteMatchMode;
  origin: {
    handler: TOriginHandler;
    options?: unknown;
  };
  requestPolicies: CompiledRequestPolicy[];
  responsePolicies: CompiledResponsePolicy[];
};

export type CompiledGateway = {
  routes: CompiledRoute[];
};

export type AnalyticsEvent = {
  routePath: string;
  method: string;
  status: number;
  latencyMs: number;
};

export type AnalyticsLogger = (
  event: AnalyticsEvent,
  env: GatewayEnv,
) => Promise<void>;

export type GatewayLogLevel = "info" | "error";

export type GatewayLogEvent = {
  level: GatewayLogLevel;
  stage: string;
  outcome: string;
  method?: string;
  routePath?: string;
  routeMethod?: string;
  originType?: string;
  policyName?: string;
  status?: number;
  latencyMs?: number;
  configSource?: string;
  configHash?: string;
  reason?: string;
};

export type GatewayLogger = (event: GatewayLogEvent) => void;

export type ExecutionDependencies = {
  now?: () => number;
  logAnalytics?: AnalyticsLogger;
  logEvent?: GatewayLogger;
};

export type GatewayExecutionContext = Pick<
  ExecutionContext,
  "waitUntil" | "passThroughOnException"
>;
