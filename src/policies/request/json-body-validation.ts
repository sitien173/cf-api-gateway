import { Validator } from "@cfworker/json-schema";
import { IRequest, TRequestPolicyHandler } from "../../types";
import { ErrorResponse } from "../../helpers/response";
import { emitGatewayLog } from "../../gateway/logging";

const validatorCache = new WeakMap<object, Validator>();
type JsonBodyValidationHandler = TRequestPolicyHandler<{ schema: object }> & {
  compile?: (options: { schema: object }) => void;
};

const getValidator = (schema: object): Validator => {
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }

  const validator = new Validator(schema);
  validatorCache.set(schema, validator);
  return validator;
};

const jsonBodyValidationHandler: JsonBodyValidationHandler = async (
  request: IRequest,
  options: { schema: object }
) => {
  let body: JSON;
  const clonedRequest = request.clone();

  try {
    body = await clonedRequest.json();
  } catch {
    return new ErrorResponse("Request body is not valid JSON", 400);
  }

  try {
    const validator = getValidator(options.schema);
    const result = validator.validate(body);
    if (result.errors.length === 0) {
      return request;
    }

    emitGatewayLog(undefined, {
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

jsonBodyValidationHandler.compile = (options) => {
  getValidator(options.schema);
};

export const jsonBodyValidation: TRequestPolicyHandler<{ schema: object }> = jsonBodyValidationHandler;
