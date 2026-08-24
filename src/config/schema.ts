import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";
import type { GatewayConfig } from "../gateway/types";

export const gatewayConfigSchema: Schema = {
  type: "object",
  required: ["routes", "policies"],
  properties: {
    routes: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "method", "origin", "policies"],
        properties: {
          path: { type: "string" },
          method: { type: "string" },
          origin: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string" },
              options: {},
            },
          },
          policies: {
            type: "object",
            required: ["request", "response"],
            properties: {
              request: {
                type: "array",
                items: { type: "string" },
              },
              response: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          options: {},
        },
      },
    },
  },
};

export type GatewayConfigValidationResult =
  | { valid: true; config: GatewayConfig }
  | { valid: false; errors: OutputUnit[] };

const unexpectedValidationError = (error: unknown): OutputUnit => ({
  keyword: "validation",
  keywordLocation: "",
  instanceLocation: "",
  error: error instanceof Error ? error.message : "Configuration validation failed",
});

export const validateGatewayConfig = (
  value: unknown,
): GatewayConfigValidationResult => {
  try {
    const result = new Validator(gatewayConfigSchema).validate(value);

    if (!result.valid) {
      return { valid: false, errors: result.errors };
    }

    return { valid: true, config: value as GatewayConfig };
  } catch (error) {
    return { valid: false, errors: [unexpectedValidationError(error)] };
  }
};
