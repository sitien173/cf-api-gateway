import { Validator } from "@cfworker/json-schema";
import { IRequest, TRequestPolicyHandler } from "../../types";
import { ErrorResponse } from "../../helpers/response";

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

export const jsonBodyValidation: TRequestPolicyHandler = async (
  request: IRequest,
  options: { schema: object }
) => {
  let body: JSON;
  const clonedRequest = request.clone();

  try {
    body = await clonedRequest.json();
  } catch (e) {
    return new ErrorResponse("Request body is not valid JSON", 400);
  }

  try {
    const validator = getValidator(options.schema);
    const result = validator.validate(body);
    if (result.errors.length === 0) {
      return request;
    }

    return new ErrorResponse(
      "Could not validate body against schema. " + result.errors[0].error,
      400,
    );
  } catch {
    return new ErrorResponse("Could not validate body against schema", 400);
  }
};
