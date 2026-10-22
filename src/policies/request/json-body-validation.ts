import { Validator } from "@cfworker/json-schema";
import { TRequestPolicyHandler } from "../../types";
import { ErrorResponse } from "../../helpers/response";
import { emitGatewayLog } from "../../gateway/logging";
import { closed } from "../../config/schema-helpers";

const validatorCache = new WeakMap<object, Validator>();

const getValidator = (schema: object): Validator => {
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }

  const validator = new Validator(schema);
  validatorCache.set(schema, validator);
  return validator;
};

type JsonBodyValidationOptions = {
  schema: object;
  maxBytes?: number;
};

const defaultMaxBytes = 1048576;

// Returns undefined as soon as the body is known to exceed maxBytes.
const readBody = async (
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | undefined> => {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return undefined;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const jsonBodyValidation: TRequestPolicyHandler<JsonBodyValidationOptions> = async (
  request: Request,
  options: JsonBodyValidationOptions,
  _env,
  log,
) => {
  const bytes = await readBody(request, options.maxBytes ?? defaultMaxBytes);
  if (!bytes) {
    return new ErrorResponse("Request body is too large", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return new ErrorResponse("Request body is not valid JSON", 400);
  }

  try {
    const validator = getValidator(options.schema);
    const result = validator.validate(body);
    if (result.errors.length === 0) {
      // The original body stream is consumed, so the buffered bytes travel on.
      return new Request(request, { body: bytes });
    }

    emitGatewayLog(log, {
      level: "error",
      stage: "request_policy",
      outcome: "validation_failed",
      reason: result.errors[0].error,
    });
    return new ErrorResponse("Could not validate body against schema", 400);
  } catch {
    return new ErrorResponse("Could not validate body against schema", 400);
  }
};

jsonBodyValidation.compile = (options) => {
  getValidator(options.schema);
};

jsonBodyValidation.optionsSchema = closed(
  {
    schema: { type: "object" },
    maxBytes: { type: "integer", minimum: 1 },
  },
  ["schema"],
);
