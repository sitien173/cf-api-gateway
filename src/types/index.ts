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
  [key: string]: any;
};

export type TRequestPolicyHandler = (
  request: IRequest,
  options: any,
  env: RequestPolicyEnv,
) => Promise<IRequest | Response>;

export type TResponsePolicyHandler = (
  response: Response,
  options: any,
  request?: IRequest
) => void | Response | Promise<void | Response>;

export type TPolicyName = string;

export type TRequestPolicy = {
  handler: TRequestPolicyHandler;
  options: any;
};

export type TResponsePolicy = {
  handler: TResponsePolicyHandler;
  options: any;
};

export type TOriginHandler = (
  request: IRequest,
  options: any
) => Promise<Response>;
