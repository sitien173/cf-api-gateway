import type { CompiledRoute } from "./types";

export const isPrefixRoute = (route: CompiledRoute): boolean =>
  route.matchMode === "prefix" || route.matchMode === "prefixStop";

export const matchesRoutePattern = (
  route: Pick<CompiledRoute, "matchMode" | "pattern" | "regex">,
  pathname: string,
): boolean => {
  if (route.matchMode === "exact") return pathname === route.pattern;
  if (route.matchMode === "prefix" || route.matchMode === "prefixStop") {
    return pathname.startsWith(route.pattern);
  }
  return route.regex?.test(pathname) === true;
};
