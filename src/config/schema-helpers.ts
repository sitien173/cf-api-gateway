import type { Schema } from "@cfworker/json-schema";

export const closed = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const stringArray: Schema = { type: "array", items: { type: "string" } };

export const httpMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];
