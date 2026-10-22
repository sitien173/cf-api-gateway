import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";
import type { GatewayConfig } from "../gateway/types";
const closed = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const stringArray: Schema = { type: "array", items: { type: "string" } };
const urlOptions = closed(
  {
    url: { type: "string" },
    pathRewrite: { type: "string" },
    timeout: { type: "number" },
  },
  ["url"],
);
const failoverOptions = closed(
  {
    primaryUrl: { type: "string" },
    fallbackUrl: { type: "string" },
    stripPrefix: { type: "string" },
    healthCheckPath: { type: "string" },
    healthCheckTimeout: { type: "number" },
    healthCheckCacheTtl: { type: "number" },
  },
  ["primaryUrl", "fallbackUrl"],
);
const corsOptions = closed(
  {
    allowedOrigins: stringArray,
    allowedMethods: stringArray,
    allowedHeaders: stringArray,
    exposedHeaders: stringArray,
    maxAge: { type: "number" },
    allowCredentials: { type: "boolean" },
  },
  ["allowedOrigins", "allowedMethods", "allowedHeaders", "allowCredentials"],
);
const types = (kind: "origin" | "policy"): string[] =>
  kind === "origin"
    ? ["url", "proxyAll", "upstreamWithFallback"]
    : [
        "cors",
        "apiKeyOrAuth0",
        "basicAuth",
        "changeMethod",
        "jsonBodyValidation",
        "addHeaders",
      ];
const conditional = (kind: "origin" | "policy"): Schema[] => {
  const opts: Record<string, Schema> =
    kind === "origin"
      ? {
          url: urlOptions,
          proxyAll: failoverOptions,
          upstreamWithFallback: failoverOptions,
        }
      : {
          cors: corsOptions,
          apiKeyOrAuth0: closed({}),
          basicAuth: closed(
            { username: { type: "string" }, password: { type: "string" } },
            ["username", "password"],
          ),
          changeMethod: closed({ method: { type: "string" } }, ["method"]),
          jsonBodyValidation: closed({ schema: { type: "object" } }, [
            "schema",
          ]),
          addHeaders: closed(
            {
              headers: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
            ["headers"],
          ),
        };
  return Object.entries(opts).map(([type, options]) => ({
    if: { properties: { type: { const: type } } },
    then: {
      properties: { options },
      ...(kind === "policy" && type === "apiKeyOrAuth0"
        ? {}
        : { required: ["options"] }),
    },
  }));
};
const originSchema: Schema = {
  ...closed(
    {
      type: { type: "string", enum: types("origin") },
      options: { type: "object" },
      description: { type: "string" },
    },
    ["type", "options"],
  ),
  allOf: conditional("origin"),
};
const policySchema: Schema = {
  ...closed(
    {
      type: { type: "string", enum: types("policy") },
      options: { type: "object" },
      description: { type: "string" },
    },
    ["type"],
  ),
  allOf: conditional("policy"),
};
const keyMap = (values: Schema): Schema => ({
  type: "object",
  propertyNames: { pattern: "^[a-z0-9][a-z0-9-]*$" },
  additionalProperties: values,
});
export const gatewayConfigSchema: Schema = closed(
  {
    origins: keyMap(originSchema),
    policies: keyMap(policySchema),
    routes: {
      type: "array",
      items: closed(
        {
          path: {
            type: "string",
            pattern: "^(?:(?:= |\\^~ )?(?!.*/\\*$)/\\S*|~\\*? \\S+)$",
          },
          methods: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: {
              type: "string",
              enum: [
                "GET",
                "HEAD",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
                "OPTIONS",
              ],
            },
          },
          origin: { type: "string" },
          request: stringArray,
          response: stringArray,
          auth: { type: "string", enum: ["none"] },
          description: { type: "string" },
        },
        ["path", "methods", "origin"],
      ),
    },
  },
  ["origins", "policies", "routes"],
);
export type GatewayConfigValidationResult =
  | { valid: true; config: GatewayConfig }
  | { valid: false; errors: OutputUnit[] };
const unexpectedValidationError = (error: unknown): OutputUnit => ({
  keyword: "validation",
  keywordLocation: "",
  instanceLocation: "",
  error:
    error instanceof Error ? error.message : "Configuration validation failed",
});
export const validateGatewayConfig = (
  value: unknown,
): GatewayConfigValidationResult => {
  try {
    const result = new Validator(gatewayConfigSchema).validate(value);
    if (!result.valid) return { valid: false, errors: result.errors };
    return { valid: true, config: value as GatewayConfig };
  } catch (error) {
    return { valid: false, errors: [unexpectedValidationError(error)] };
  }
};
