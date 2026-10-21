export declare interface IRequest extends Request {
  user?: string;
}

export declare interface IRequestInit extends RequestInit {
  user?: string;
  headers: Headers;
}

export interface Auth0Bindings {
  AUTH0_ISSUER?: string;
  AUTH0_AUDIENCE?: string;
}

export type RequestPolicyEnv = Auth0Bindings & {
  [key: string]: unknown;
};

export type TRequestPolicyHandler<TOptions = unknown> = {
  handle(
    request: IRequest,
    options: TOptions,
    env: RequestPolicyEnv,
  ): Promise<IRequest | Response>;
}["handle"];

export type TResponsePolicyHandler<TOptions = unknown> = {
  handle(
    response: Response,
    options: TOptions,
    request?: IRequest,
  ): void | Response | Promise<void | Response>;
}["handle"];

export type TRequestPolicy = {
  handler: TRequestPolicyHandler;
  options: unknown;
};

export type TResponsePolicy = {
  handler: TResponsePolicyHandler;
  options: unknown;
};

export type TOriginHandler<TOptions = unknown> = {
  handle(request: IRequest, options: TOptions): Promise<Response>;
}["handle"];
