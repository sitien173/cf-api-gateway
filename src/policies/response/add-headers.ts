import { TResponsePolicyHandler } from "../../types";
import { closed } from "../../config/schema-helpers";

type AddHeadersOptions = {
  headers: Record<string, string>;
};

export const addHeaders: TResponsePolicyHandler<AddHeadersOptions> = (
  response: Response,
  options: AddHeadersOptions
) => {
  for (const [key, value] of Object.entries(options.headers)) {
    response.headers.set(key, value);
  }
};

addHeaders.optionsSchema = closed(
  { headers: { type: "object", additionalProperties: { type: "string" } } },
  ["headers"],
);
