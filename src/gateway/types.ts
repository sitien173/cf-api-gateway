import type {
  TOriginHandler,
  TRequestPolicyHandler,
  TResponsePolicyHandler,
} from "../types";

export type GatewayEnv = {
  GATEWAY_NAME?: string;
  ANALYTICS_ENABLED?: string;
  [key: string]: any;
};

export type GatewayPolicyConfig = {
  name: string;
  type: string;
  options?: any;
};

export type GatewayRouteConfig = {
  path: string;
  method: string;
  origin: {
    type: string;
    options?: any;
  };
  policies: {
    request: string[];
    response: string[];
  };
};

export type GatewayConfig = {
  routes: GatewayRouteConfig[];
  policies: GatewayPolicyConfig[];
};

export type GatewayHandlers = {
  requestPolicies: Record<string, TRequestPolicyHandler>;
  responsePolicies: Record<string, TResponsePolicyHandler>;
  origins: Record<string, TOriginHandler>;
};

export type CompiledRequestPolicy = {
  name: string;
  options?: any;
  handler: TRequestPolicyHandler;
};

export type CompiledResponsePolicy = {
  name: string;
  options?: any;
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
    options?: any;
  };
  requestPolicies: CompiledRequestPolicy[];
  responsePolicies: CompiledResponsePolicy[];
};

export type CompiledGateway = {
  routes: CompiledRoute[];
};

export type AnalyticsLogger = (
  request: Request,
  response: Response,
  env: GatewayEnv,
  latency: number
) => Promise<void>;

export type GatewayLogLevel = "info" | "error";

export type GatewayLogEvent = {
  level: GatewayLogLevel;
  stage: string;
  outcome: string;
  method: string;
  path: string;
  query: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  routePath?: string;
  routeMethod?: string;
  originType?: string;
  policyName?: string;
  status?: number;
  latencyMs?: number;
  targetUrl?: string;
  errorMessage?: string;
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
