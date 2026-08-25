import { executeFailoverOrigin } from "./failover";
import type { TOriginHandler } from "../types";

export const upstreamWithFallback: TOriginHandler = (request, options) =>
  executeFailoverOrigin(request, options, "upstreamWithFallback");
