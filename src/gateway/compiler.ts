import type {
  TRequestPolicyHandler,
  TResponsePolicyHandler,
} from "../types";
import { httpMethods } from "../config/schema-helpers";
import { errorMessage } from "../helpers/errors";
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
const knownMethods = new Set(httpMethods);
const gatewayAuthTypes = new Set(["apiKeyOrAuth0", "basicAuth"]);
const bodyPolicyTypes = new Set(["jsonBodyValidation", "changeMethod"]);

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
    type: string;
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

    return {
      name,
      type: definition.type,
      options: definition.options,
      handler,
    } as TPolicy;
  });

// Each defined policy compiles once, whether or not a route references it.
const compilePolicies = (config: GatewayConfig, handlers: GatewayHandlers): void => {
  for (const [name, policy] of Object.entries(config.policies)) {
    const handler =
      handlers.requestPolicies[policy.type] ?? handlers.responsePolicies[policy.type];
    try {
      handler?.compile?.(policy.options);
    } catch (error) {
      throw Object.assign(new Error(`Policy ${name}: ${errorMessage(error)}`), { cause: error });
    }
  }
};

// Bare and ^~ prefixes share a key; regexes key on the full path so ~ and ~* differ.
const duplicateKey = (matchMode: RouteMatchMode, pattern: string, path: string): string => {
  if (matchMode === "exact") return `exact:${pattern}`;
  if (matchMode === "regex") return `regex:${path}`;
  return `prefix:${pattern}`;
};

const compileRouteMethod = (
  route: GatewayConfig["routes"][number],
  method: string,
  config: GatewayConfig,
  handlers: GatewayHandlers,
  seenRoutes: Set<string>,
  order: number,
): CompiledRoute => {
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
      new Error(`${routeLabel}invalid regex ${errorMessage(error)}`),
      { cause: error },
    );
  }
  const routeKey = `${method}\0${duplicateKey(parsedPath.matchMode, parsedPath.pattern, route.path)}`;
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
  // A changeMethod policy can turn a public route into a write, so its target counts too.
  const requestTypes = requestNames.map((name) => config.policies[name].type);
  const targetMethods = [
    method,
    ...requestNames
      .filter((name) => config.policies[name].type === "changeMethod")
      .map((name) => String(config.policies[name].options?.method).toUpperCase()),
  ];
  const requiresAuth =
    route.auth !== "none" && targetMethods.some((target) => !publicMethods.has(target));
  if (requiresAuth) {
    const authIndex = requestTypes.findIndex((type) => gatewayAuthTypes.has(type));
    if (authIndex === -1) {
      throw new Error(`${routeLabel}must use an apiKeyOrAuth0 or basicAuth policy`);
    }
    const bodyIndex = requestTypes.findIndex((type) => bodyPolicyTypes.has(type));
    if (bodyIndex !== -1 && authIndex > bodyIndex) {
      throw new Error(
        `${routeLabel}must run its auth policy before jsonBodyValidation and changeMethod`,
      );
    }
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

const routeTiers: Record<RouteMatchMode, number> = {
  exact: 0,
  prefix: 1,
  prefixStop: 1,
  regex: 2,
};

const routeTier = (route: CompiledRoute): number => routeTiers[route.matchMode];

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
  compilePolicies(config, handlers);

  const routes: CompiledRoute[] = [];
  const seenRoutes = new Set<string>();

  for (const [order, route] of config.routes.entries()) {
    for (const method of route.methods) {
      routes.push(compileRouteMethod(route, method, config, handlers, seenRoutes, order));
    }
  }

  routes.sort(compareRoutes);

  const routesByMethod = new Map<string, CompiledRoute[]>();
  for (const route of routes) {
    const methodRoutes = routesByMethod.get(route.method) ?? [];
    methodRoutes.push(route);
    routesByMethod.set(route.method, methodRoutes);
  }

  return { routes, routesByMethod };
};
