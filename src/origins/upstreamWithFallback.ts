import {
  executeFailoverOrigin,
  failoverOptionsSchema,
  type FailoverOriginOptions,
} from "./failover";
import type { TOriginHandler } from "../types";

export const upstreamWithFallback: TOriginHandler<FailoverOriginOptions> = (request, options, ctx) =>
  executeFailoverOrigin(request, options, "upstreamWithFallback", ctx);

upstreamWithFallback.optionsSchema = failoverOptionsSchema;
