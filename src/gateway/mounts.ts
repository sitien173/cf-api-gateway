import type { CompiledGateway, CompiledRoute } from "./types";

export type MountRecoverySource = "referer" | "cookie";

export type MountResolution = {
  requestUrl: URL;
  route?: CompiledRoute;
  mount?: string;
  source?: MountRecoverySource;
};

export type MountRouteResolver = (requestUrl: URL) => CompiledRoute | undefined;

const isUnderMount = (pathname: string, mount: string): boolean =>
  pathname === mount || pathname.startsWith(`${mount}/`);

export const buildMountRecoveryUrl = (requestUrl: URL, mount: string): URL => {
  const recoveredUrl = new URL(requestUrl);
  recoveredUrl.pathname = `${mount}${requestUrl.pathname}`;
  return recoveredUrl;
};

export const getMountForPath = (
  pathname: string,
  mounts: string[],
): string | undefined => mounts.find((mount) => isUnderMount(pathname, mount));

export const buildMountContextCookie = (mount: string): string =>
  `__Host-gw_mount=${mount}; Path=/; Secure; HttpOnly; SameSite=Lax`;

export const mountCookieNamespaceKey = (mount: string): string =>
  mount.slice(1).replaceAll("/", ".");

const getCookieNamePrefix = (name: string): string => {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith("__host-")) return name.slice(0, "__Host-".length);
  if (lowerName.startsWith("__secure-")) return name.slice(0, "__Secure-".length);
  return "";
};

const getCookieAttributes = (cookie: string): string[] => cookie.split(";").slice(1);

const getCookieAttribute = (attribute: string): [string, string] => {
  const separator = attribute.indexOf("=");
  return separator < 0
    ? [attribute.trim().toLowerCase(), ""]
    : [
        attribute.slice(0, separator).trim().toLowerCase(),
        attribute.slice(separator + 1).trim(),
      ];
};

const isDeletingCookie = (cookie: string, now: number): boolean => {
  const attributes = getCookieAttributes(cookie);
  const maxAgeAttribute = attributes
    .map(getCookieAttribute)
    .find(([name, value]) => name === "max-age" && /^[+-]?\d+$/.test(value));
  if (maxAgeAttribute) return Number(maxAgeAttribute[1]) <= 0;

  return attributes.some((attribute) => {
    const [name, value] = getCookieAttribute(attribute);
    if (name !== "expires") return false;
    const expiresAt = Date.parse(value);
    return !Number.isNaN(expiresAt) && expiresAt <= now;
  });
};

const hasHttpOnlyAttribute = (cookie: string): boolean =>
  getCookieAttributes(cookie).some(
    (attribute) => getCookieAttribute(attribute)[0] === "httponly",
  );

const renameSetCookie = (
  cookie: string,
  name: string,
  forceRootPath: boolean,
): string => {
  const attributes = cookie.split(";");
  const pair = attributes[0] ?? "";
  const separator = pair.indexOf("=");
  if (separator < 0) return cookie;
  const leadingWhitespace = pair.match(/^\s*/)?.[0] ?? "";
  attributes[0] = `${leadingWhitespace}${name}${pair.slice(separator)}`;
  let pathFound = false;
  for (let index = 1; index < attributes.length; index += 1) {
    const attribute = attributes[index] ?? "";
    if (!forceRootPath || getCookieAttribute(attribute)[0] !== "path") continue;
    attributes[index] = " Path=/";
    pathFound = true;
  }
  if (forceRootPath && !pathFound) attributes.push(" Path=/");
  return attributes.join(";");
};

export const rewriteMountSetCookies = (
  response: Response,
  mount: string,
  now: () => number,
): Response => {
  const originalCookies = response.headers.getSetCookie();
  if (originalCookies.length === 0) return response;

  const namespaceKey = mountCookieNamespaceKey(mount);
  const currentTime = now();
  let changed = false;
  const rewrittenCookies = originalCookies.flatMap((cookie) => {
    const pair = cookie.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 0) return [cookie];
    const name = pair.slice(0, separator).trim();
    if (name === "__Host-gw_mount") return [cookie];
    const prefix = getCookieNamePrefix(name);
    const unprefixedName = name.slice(prefix.length);
    const renamed = `${prefix}gwm_${namespaceKey}__${unprefixedName}`;
    const httpOnly = hasHttpOnlyAttribute(cookie);
    const deleting = isDeletingCookie(cookie, currentTime);

    if (httpOnly) {
      changed = true;
      const namespacedCookie = renameSetCookie(cookie, renamed, true);
      return deleting ? [cookie, namespacedCookie] : [namespacedCookie];
    }
    if (deleting) {
      changed = true;
      return [cookie, renameSetCookie(cookie, renamed, true)];
    }
    return [cookie];
  });

  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  for (const cookie of rewrittenCookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const removeMountContextCookie = (
  request: Request,
  mount?: string,
): Request => {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return request;

  const ownNamespace = mount ? `gwm_${mountCookieNamespaceKey(mount)}__` : undefined;
  const parsedPairs = cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      if (separator < 0) {
        return { pair, drop: pair === "__Host-gw_mount" };
      }

      const name = pair.slice(0, separator).trim();
      if (name === "__Host-gw_mount") return { pair, name, drop: true };
      const prefix = getCookieNamePrefix(name);
      const unprefixedName = name.slice(prefix.length);
      if (!unprefixedName.startsWith("gwm_")) return { pair, name };
      if (!ownNamespace || !unprefixedName.startsWith(ownNamespace)) {
        return { pair, name, drop: true };
      }

      const restoredName = `${prefix}${unprefixedName.slice(ownNamespace.length)}`;
      if (restoredName === "__Host-gw_mount") return { pair, name: restoredName, drop: true };
      return {
        pair: `${restoredName}${pair.slice(separator)}`,
        name: restoredName,
        restored: true,
      };
    });
  const restoredNames = new Set(
    parsedPairs.flatMap((pair) => pair.restored && pair.name ? [pair.name] : []),
  );
  const remainingPairs = parsedPairs
    .filter(
      (pair) =>
        !pair.drop && !(pair.name && !pair.restored && restoredNames.has(pair.name)),
    )
    .map((pair) => pair.pair);
  const changed =
    remainingPairs.length === 0 ||
    remainingPairs.length !== parsedPairs.length ||
    parsedPairs.some((pair) => pair.restored);
  if (!changed) return request;

  const headers = new Headers(request.headers);
  if (remainingPairs.length === 0) headers.delete("cookie");
  else headers.set("cookie", remainingPairs.join("; "));
  return new Request(request, { headers });
};

const getDeclaredContextMount = (
  request: Request,
  mounts: string[],
): string | undefined => {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;

  for (const pair of cookie.split(";")) {
    const trimmedPair = pair.trim();
    const separator = trimmedPair.indexOf("=");
    if (separator < 0 || trimmedPair.slice(0, separator).trim() !== "__Host-gw_mount") {
      continue;
    }
    const value = trimmedPair.slice(separator + 1).trim();
    if (mounts.includes(value)) return value;
  }
  return undefined;
};

export const resolveMountRequest = (
  gateway: CompiledGateway,
  request: Request,
  requestUrl: URL,
  resolveRoute: MountRouteResolver,
): MountResolution => {
  if (gateway.mounts.length === 0) {
    return { requestUrl, route: resolveRoute(requestUrl) };
  }

  if (gateway.mounts.some((mount) => isUnderMount(requestUrl.pathname, mount))) {
    return { requestUrl, route: resolveRoute(requestUrl) };
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === requestUrl.origin) {
        for (const mount of gateway.mounts) {
          if (!isUnderMount(refererUrl.pathname, mount)) continue;
          const recoveredUrl = buildMountRecoveryUrl(requestUrl, mount);
          const route = resolveRoute(recoveredUrl);
          if (route) {
            return { requestUrl: recoveredUrl, route, mount, source: "referer" };
          }
        }
      }
    } catch {
      // Invalid Referer headers do not participate in mount recovery.
    }
  }

  const normalRoute = resolveRoute(requestUrl);
  if (normalRoute) return { requestUrl, route: normalRoute };

  const mount = getDeclaredContextMount(request, gateway.mounts);
  if (mount) {
    const recoveredUrl = buildMountRecoveryUrl(requestUrl, mount);
    const route = resolveRoute(recoveredUrl);
    if (route) {
      return { requestUrl: recoveredUrl, route, mount, source: "cookie" };
    }
  }

  return { requestUrl };
};
