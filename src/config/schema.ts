import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";
import type { GatewayConfig } from "../gateway/types";
import type { HandlerMetadata } from "../types";
import * as origins from "../origins";
import * as requestPolicies from "../policies/request";
import * as responsePolicies from "../policies/response";
import { closed, httpMethods, stringArray } from "./schema-helpers";
const policies: Record<string, HandlerMetadata<never>> = {
  ...requestPolicies,
  ...responsePolicies,
};
// Each handler's optionsSchema closes its options; options are required when that schema requires a field.
const conditional = (handlers: Record<string, HandlerMetadata<never>>): Schema[] =>
  Object.entries(handlers).map(([type, { optionsSchema = closed({}) }]) => ({
    if: { properties: { type: { const: type } } },
    then: {
      properties: { options: optionsSchema },
      ...(optionsSchema.required?.length ? { required: ["options"] } : {}),
    },
  }));
const originSchema: Schema = {
  ...closed(
    {
      type: { type: "string", enum: Object.keys(origins) },
      options: { type: "object" },
      description: { type: "string" },
    },
    ["type", "options"],
  ),
  allOf: conditional(origins),
};
const policySchema: Schema = {
  ...closed(
    {
      type: { type: "string", enum: Object.keys(policies) },
      options: { type: "object" },
      description: { type: "string" },
    },
    ["type"],
  ),
  allOf: conditional(policies),
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
            pattern: String.raw`^(?:(?:= |\^~ )?(?!.*/\*$)/\S*|~\*? \S+)$`,
          },
          methods: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", enum: httpMethods },
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
const validator = new Validator(gatewayConfigSchema);
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
    const result = validator.validate(value);
    if (!result.valid) return { valid: false, errors: result.errors };
    return { valid: true, config: value as GatewayConfig };
  } catch (error) {
    return { valid: false, errors: [unexpectedValidationError(error)] };
  }
};
