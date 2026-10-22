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

export const parseRoutePath = (
  path: string,
): { matchMode: RouteMatchMode; pattern: string; regex?: RegExp } => {
  if (path.startsWith("= ")) return { matchMode: "exact", pattern: path.slice(2) };
  if (path.startsWith("^~ ")) return { matchMode: "prefixStop", pattern: path.slice(3) };
  if (path.startsWith("~* ")) {
    const pattern = path.slice(3);
    return { matchMode: "regex", pattern, regex: new RegExp(pattern, "i") };
  }
  if (path.startsWith("~ ")) {
    const pattern = path.slice(2);
    return { matchMode: "regex", pattern, regex: new RegExp(pattern) };
  }
  return { matchMode: "prefix", pattern: path };
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
  order: number,
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

  let parsedPath: ReturnType<typeof parseRoutePath>;
  try {
    parsedPath = parseRoutePath(route.path);
  } catch (error) {
    throw Object.assign(
      new Error(`${routeLabel}invalid regex ${error instanceof Error ? error.message : String(error)}`),
      { cause: error },
    );
  }
  const duplicateKey =
    parsedPath.matchMode === "exact"
      ? `exact:${parsedPath.pattern}`
      : parsedPath.matchMode === "prefix" || parsedPath.matchMode === "prefixStop"
        ? `prefix:${parsedPath.pattern}`
        : `regex:${route.path}`;
  const routeKey = `${method}\0${duplicateKey}`;
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

  // GET, HEAD, and OPTIONS routes are auth-optional by design; all other methods require gateway auth
  // unless the route sets auth "none" because the origin enforces its own auth.
  const requiresAuth = !publicMethods.has(method) && route.auth !== "none";
  const hasGatewayAuthPolicy = requestNames.some(
    (name) => config.policies[name]?.type === "apiKeyOrAuth0",
  );
  if (requiresAuth && !hasGatewayAuthPolicy) {
    throw new Error(`${routeLabel}must use an apiKeyOrAuth0 policy`);
  }

  return {
    path: route.path,
    pattern: parsedPath.pattern,
    method,
    originType: origin.type,
    matchMode: parsedPath.matchMode,
    ...(parsedPath.regex ? { regex: parsedPath.regex } : {}),
    order,
    origin: {
      handler: originHandler,
      options: origin.options,
    },
    requestPolicies,
    responsePolicies,
  };
};

const routeTier = (route: CompiledRoute): number =>
  route.matchMode === "exact" ? 0 : route.matchMode === "regex" ? 2 : 1;

const compareRoutes = (left: CompiledRoute, right: CompiledRoute): number => {
  const matchModeOrder = routeTier(left) - routeTier(right);
  if (matchModeOrder !== 0) {
    return matchModeOrder;
  }

  if (left.matchMode === "regex" && right.matchMode === "regex") {
    return left.order - right.order;
  }

  const pathLengthOrder = right.pattern.length - left.pattern.length;
  if (pathLengthOrder !== 0) {
    return pathLengthOrder;
  }

  const pathOrder = left.pattern.localeCompare(right.pattern);
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

  for (const [order, route] of config.routes.entries()) {
    for (const configuredMethod of route.methods) {
      routes.push(
        compileRouteMethod(route, configuredMethod, config, handlers, seenRoutes, order),
      );
    }
  }

  routes.sort(compareRoutes);

  return { routes };
};
