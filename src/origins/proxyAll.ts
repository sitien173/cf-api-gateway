import { executeFailoverOrigin, type FailoverOriginOptions } from "./failover";
import type { TOriginHandler } from "../types";

export const proxyAll: TOriginHandler<FailoverOriginOptions> = (request, options) =>
  executeFailoverOrigin(request, options, "proxyAll");
