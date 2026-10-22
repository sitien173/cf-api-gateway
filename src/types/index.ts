import type { Schema } from "@cfworker/json-schema";
import type { GatewayEnv, GatewayLogger } from "../gateway/types";

// The configuration schema reads optionsSchema; the compiler calls compile once per policy.
export type HandlerMetadata<TOptions> = {
  optionsSchema?: Schema;
  compile?(options: TOptions): void;
};

export type TRequestPolicyHandler<TOptions = unknown> = {
  handle(
    request: Request,
    options: TOptions,
    // Policies may read a Worker secret whose name comes from their options.
    env: GatewayEnv & Record<string, unknown>,
    log?: GatewayLogger,
  ): Promise<Request | Response>;
}["handle"] &
  HandlerMetadata<TOptions>;

export type TResponsePolicyHandler<TOptions = unknown> = {
  handle(
    response: Response,
    options: TOptions,
    request?: Request,
  ): void | Response | Promise<void | Response>;
}["handle"] &
  HandlerMetadata<TOptions>;

// Origins pass background work to waitUntil so it survives the end of the invocation.
export type OriginContext = {
  waitUntil(promise: Promise<unknown>): void;
  log: GatewayLogger;
};

export type TOriginHandler<TOptions = unknown> = {
  handle(request: Request, options: TOptions, ctx: OriginContext): Promise<Response>;
}["handle"] &
  HandlerMetadata<TOptions>;
