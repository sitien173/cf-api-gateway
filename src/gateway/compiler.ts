import type {
  TRequestPolicyHandler,
  TResponsePolicyHandler,
} from "../types";
import type {
  CompiledGateway,
  CompiledRequestPolicy,
  CompiledResponsePolicy,
  CompiledRoute,
  GatewayConfig,
  GatewayHandlers,
  PolicyConfig,
  RouteMatchMode,
} from "./types";

const hasWildcardSuffix = (path: string): boolean => path.endsWith("/*");
const publicMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const knownMethods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

const resolveMatchMode = (originType: string, path: string): RouteMatchMode =>
  originType === "proxyAll" || hasWildcardSuffix(path) ? "prefix" : "exact";

const normalizeRoutePath = (
  path: string,
  matchMode: RouteMatchMode,
): string => {
  if (matchMode === "prefix" && hasWildcardSuffix(path)) {
    return path.slice(0, -1);
  }

  return path;
};

const resolvePolicies = <
  TPolicy extends {
    name: string;
    options?: unknown;
    handler: TRequestPolicyHandler | TResponsePolicyHandler;
  },
>(
  names: string[],
  policyDefinitions: Record<string, PolicyConfig>,
  resolver: Record<string, TRequestPolicyHandler | TResponsePolicyHandler>,
  routeLabel: string,
): TPolicy[] =>
  names.map((name) => {
    const definition = policyDefinitions[name];
    if (!definition) {
      throw new Error(`${routeLabel}Policy ${name} not found`);
    }

    const handler = resolver[definition.type];
    if (!handler) {
      throw new Error(
        `${routeLabel}policy "${name}" type ${definition.type} not found in this phase`,
      );
    }

    const compilableHandler = handler as
      | (TRequestPolicyHandler & { compile?: (options: unknown) => void })
      | (TResponsePolicyHandler & { compile?: (options: unknown) => void });
    compilableHandler.compile?.(definition.options);

    return {
      name,
      options: definition.options,
      handler,
    } as TPolicy;
  });

const assertCorsPolicies = (config: GatewayConfig): void => {
  for (const [name, policy] of Object.entries(config.policies)) {
    if (
      policy.type === "cors" &&
      policy.options?.allowCredentials === true &&
      Array.isArray(policy.options.allowedOrigins) &&
      policy.options.allowedOrigins.includes("*")
    ) {
      throw new Error(
        `CORS policy ${name} cannot combine wildcard allowed origins with credentials`,
      );
    }
  }
};

const compileRouteMethod = (
  route: GatewayConfig["routes"][number],
  configuredMethod: string,
  config: GatewayConfig,
  handlers: GatewayHandlers,
  seenRoutes: Set<string>,
): CompiledRoute => {
  const method = configuredMethod.toUpperCase();
  const routeLabel = `Route ${method} ${route.path}: `;
  if (!knownMethods.has(method)) {
    throw new Error(`${routeLabel}Unknown HTTP method ${method}`);
  }
  const origin = config.origins[route.origin];
  if (!origin) {
    throw new Error(`${routeLabel}origin "${route.origin}" not found`);
  }

  const originHandler = handlers.origins[origin.type];
  if (!originHandler) {
    throw new Error(`${routeLabel}origin type ${origin.type} not found`);
  }

  const routeKey = `${method}\0${route.path}`;
  if (seenRoutes.has(routeKey)) {
    throw new Error(`${routeLabel}duplicate path and method`);
  }
  seenRoutes.add(routeKey);

  const requestNames = route.request ?? [];
  const responseNames = route.response ?? [];
  const requestPolicies = resolvePolicies<CompiledRequestPolicy>(
    requestNames,
    config.policies,
    handlers.requestPolicies,
    routeLabel,
  );
  const responsePolicies = resolvePolicies<CompiledResponsePolicy>(
    responseNames,
    config.policies,
    handlers.responsePolicies,
    routeLabel,
  );

  // GET, HEAD, and OPTIONS routes are auth-optional by design; all other methods require gateway auth.
  const requiresAuth = !publicMethods.has(method);
  const hasGatewayAuthPolicy = requestNames.some(
    (name) => config.policies[name]?.type === "apiKeyOrAuth0",
  );
  if (requiresAuth && !hasGatewayAuthPolicy) {
    throw new Error(`${routeLabel}must use an apiKeyOrAuth0 policy`);
  }

  const matchMode = resolveMatchMode(origin.type, route.path);
  return {
    path: normalizeRoutePath(route.path, matchMode),
    method,
    originType: origin.type,
    matchMode,
    origin: {
      handler: originHandler,
      options: origin.options,
    },
    requestPolicies,
    responsePolicies,
  };
};

const compareRoutes = (left: CompiledRoute, right: CompiledRoute): number => {
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
};

// Compilation is all-or-nothing: failures throw before a gateway is returned.
export const compileGateway = (
  config: GatewayConfig,
  handlers: GatewayHandlers,
): CompiledGateway => {
  assertCorsPolicies(config);

  const routes: CompiledRoute[] = [];
  const seenRoutes = new Set<string>();

  for (const route of config.routes) {
    for (const configuredMethod of route.methods) {
      routes.push(
        compileRouteMethod(route, configuredMethod, config, handlers, seenRoutes),
      );
    }
  }

  routes.sort(compareRoutes);

  return { routes };
};
