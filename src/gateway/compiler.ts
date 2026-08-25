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
const knownMethods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "PATCH",
]);
const publicMethods = new Set(["GET", "HEAD", "OPTIONS"]);

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
    if (policyMap.has(policy.name)) {
      throw new Error(`Duplicate policy name ${policy.name}`);
    }

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

// Compilation is all-or-nothing: failures throw before a gateway is returned.
export const compileGateway = (
  config: GatewayConfig,
  handlers: GatewayHandlers,
): CompiledGateway => {
  const policyDefinitions = buildPolicyDefinitions(
    config.policies,
  );

  for (const policy of config.policies) {
    if (
      policy.type === "cors" &&
      policy.options?.allowCredentials === true &&
      Array.isArray(policy.options.allowedOrigins) &&
      policy.options.allowedOrigins.includes("*")
    ) {
      throw new Error(
        `CORS policy ${policy.name} cannot combine wildcard allowed origins with credentials`,
      );
    }
  }

  const routes: CompiledRoute[] = config.routes.map((route) => {
    const originHandler = handlers.origins[route.origin.type];
    if (!originHandler) {
      throw new Error(`Origin ${route.origin.type} not found`);
    }

    const method = route.method.toUpperCase();
    if (!knownMethods.has(method)) {
      throw new Error(`Unknown HTTP method ${route.method}`);
    }

    const matchMode = resolveMatchMode(route.origin.type, route.path);

    const requestPolicies = resolvePolicies<CompiledRequestPolicy>(
      route.policies.request,
      policyDefinitions,
      handlers.requestPolicies,
    );
    const requiresAuth = !publicMethods.has(method);
    const hasGatewayAuthPolicy = route.policies.request.some(
      (name) => policyDefinitions.get(name)?.type === "apiKeyOrAuth0",
    );

    if (requiresAuth && !hasGatewayAuthPolicy) {
      throw new Error(`Route ${method} ${route.path} must use an apiKeyOrAuth0 policy`);
    }

    return {
      path: normalizeRoutePath(route.path, matchMode),
      method,
      originType: route.origin.type,
      matchMode,
      origin: {
        handler: originHandler,
        options: route.origin.options,
      },
      requestPolicies,
      responsePolicies: resolvePolicies<CompiledResponsePolicy>(
        route.policies.response,
        policyDefinitions,
        handlers.responsePolicies,
      ),
    };
  }).sort((left, right) => {
    const matchModeOrder =
      (left.matchMode === "exact" ? 0 : 1) -
      (right.matchMode === "exact" ? 0 : 1);
    if (matchModeOrder !== 0) {
      return matchModeOrder;
    }

    const pathLengthOrder = right.path.length - left.path.length;
    if (pathLengthOrder !== 0) {
      return pathLengthOrder;
    }

    const pathOrder = left.path.localeCompare(right.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }

    const methodOrder = left.method.localeCompare(right.method);
    if (methodOrder !== 0) {
      return methodOrder;
    }

    return left.originType.localeCompare(right.originType);
  });

  return { routes };
};
