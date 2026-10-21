import { executeFailoverOrigin, type FailoverOriginOptions } from "./failover";
import type { TOriginHandler } from "../types";

export const upstreamWithFallback: TOriginHandler<FailoverOriginOptions> = (request, options) =>
  executeFailoverOrigin(request, options, "upstreamWithFallback");
