import type {
  CompiledGateway,
  CompiledRequestPolicy,
  CompiledResponsePolicy,
  CompiledRoute,
  GatewayConfig,
  GatewayHandlers,
  GatewayPolicyConfig,
  RouteMatchMode,
} from "./types";

const hasWildcardSuffix = (path: string): boolean => path.endsWith("/*");

const resolveMatchMode = (originType: string, path: string): RouteMatchMode =>
  originType === "proxyAll" || hasWildcardSuffix(path) ? "prefix" : "exact";

const normalizeRoutePath = (path: string, matchMode: RouteMatchMode): string => {
  if (matchMode === "prefix" && hasWildcardSuffix(path)) {
    return path.slice(0, -1);
  }

  return path;
};

const buildPolicyDefinitions = (
  policies: GatewayPolicyConfig[],
): Map<string, GatewayPolicyConfig> => {
  const policyMap = new Map<string, GatewayPolicyConfig>();
  for (const policy of policies) {
    policyMap.set(policy.name, policy);
  }

  return policyMap;
};

const resolvePolicies = <TPolicy extends { name: string; options?: any; handler: any }>(
  names: string[],
  policyDefinitions: Map<string, GatewayPolicyConfig>,
  resolver: Record<string, any>,
): TPolicy[] =>
  names.map((name) => {
    const definition = policyDefinitions.get(name);
    if (!definition) {
      throw new Error(`Policy ${name} not found`);
    }

    const handler = resolver[definition.type];
    if (!handler) {
      throw new Error(`Policy type ${definition.type} not found`);
    }

    return {
      name: definition.name,
      options: definition.options,
      handler,
    } as TPolicy;
  });

export const compileGateway = (
  config: GatewayConfig,
  handlers: GatewayHandlers,
): CompiledGateway => {
  const policyDefinitions = buildPolicyDefinitions(
    config.policies,
  );

  const routes: CompiledRoute[] = config.routes.map((route) => {
    const originHandler = handlers.origins[route.origin.type];
    if (!originHandler) {
      throw new Error(`Origin ${route.origin.type} not found`);
    }

    const matchMode = resolveMatchMode(route.origin.type, route.path);

    return {
      path: normalizeRoutePath(route.path, matchMode),
      method: route.method,
      originType: route.origin.type,
      matchMode,
      origin: {
        handler: originHandler,
        options: route.origin.options,
      },
      requestPolicies: resolvePolicies<CompiledRequestPolicy>(
        route.policies.request,
        policyDefinitions,
        handlers.requestPolicies,
      ),
      responsePolicies: resolvePolicies<CompiledResponsePolicy>(
        route.policies.response,
        policyDefinitions,
        handlers.responsePolicies,
      ),
    };
  });

  return { routes };
};
