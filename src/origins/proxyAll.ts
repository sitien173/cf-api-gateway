import { executeFailoverOrigin } from "./failover";
import type { TOriginHandler } from "../types";

export const proxyAll: TOriginHandler = (request, options) =>
  executeFailoverOrigin(request, options, "proxyAll");
