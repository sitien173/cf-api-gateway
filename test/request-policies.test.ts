import test from "node:test";
import assert from "node:assert/strict";

import { changeMethod } from "../src/policies/request/change-method.ts";
import { jsonBodyValidation } from "../src/policies/request/json-body-validation.ts";
import { basicAuth } from "../src/policies/request/basic-auth.ts";
import { constantTimeEqual } from "../src/helpers/compare.ts";
import { compileGateway } from "../src/gateway/compiler.ts";

test("compileGateway builds JSON validators during policy compilation", () => {
  assert.throws(() =>
    compileGateway(
      {
        origins: {
          origin: {
            type: "url",
            options: { url: "https://origin.example.com" },
          },
        },
        policies: {
          validate: {
            type: "jsonBodyValidation",
            options: { schema: null as unknown as object },
          },
        },
        routes: [
          {
            path: "/validate",
            methods: ["OPTIONS"],
            origin: "origin",
            request: ["validate"],
            response: [],
          },
        ],
      },
      {
        requestPolicies: { jsonBodyValidation },
        responsePolicies: {},
        origins: { url: async () => new Response("ok") },
      },
    ),
  );
});

test("JSON schema mismatches return HTTP 400", async () => {
  const response = await jsonBodyValidation(
    new Request("https://gateway.example.com/orders", {
      method: "POST",
      body: JSON.stringify({ count: "not-a-number" }),
    }),
    { schema: { type: "object", properties: { count: { type: "number" } } } },
    {},
  );

  assert.equal(response instanceof Response, true);
  assert.equal((response as Response).status, 400);
  assert.deepEqual(
    JSON.parse(await (response as Response).text()),
    { message: "Could not validate body against schema" },
  );
});

test("JSON validator configuration failures return HTTP 400", async () => {
  const missingSchema = await jsonBodyValidation(
    new Request("https://gateway.example.com/orders", {
      method: "POST",
      body: "{}",
    }),
    {} as { schema: object },
    {},
  );
  const malformedSchema = await jsonBodyValidation(
    new Request("https://gateway.example.com/orders", {
      method: "POST",
      body: "{}",
    }),
    { schema: { type: "not-a-json-schema-type" } },
    {},
  );

  assert.equal((missingSchema as Response).status, 400);
  assert.equal((malformedSchema as Response).status, 400);
});

test("JSON bodies over maxBytes return HTTP 413 by declared or streamed size", async () => {
  const options = { schema: { type: "object" }, maxBytes: 8 };
  const declared = await jsonBodyValidation(
    new Request("https://gateway.example.com/orders", {
      method: "POST",
      headers: { "Content-Length": "5000" },
      body: "{}",
    }),
    options,
    {},
  );
  const streamed = await jsonBodyValidation(
    new Request("https://gateway.example.com/orders", {
      method: "POST",
      body: JSON.stringify({ name: "longer than eight bytes" }),
    }),
    options,
    {},
  );

  assert.equal((declared as Response).status, 413);
  assert.equal((streamed as Response).status, 413);
});

test("valid JSON bodies are forwarded unchanged after validation", async () => {
  const body = JSON.stringify({ count: 2 });
  const result = await jsonBodyValidation(
    new Request("https://gateway.example.com/orders", { method: "POST", body }),
    { schema: { type: "object", properties: { count: { type: "number" } } } },
    {},
  );

  assert.ok(result instanceof Request);
  assert.equal(await result.text(), body);
});

test("constant-time comparison requires equal strings", () => {
  assert.equal(constantTimeEqual("secret", "secret"), true);
  assert.equal(constantTimeEqual("secret", "secreT"), false);
  assert.equal(constantTimeEqual("secret", "secret-longer"), false);
});

test("method changes remove bodies for GET and HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    const request = new Request("https://gateway.example.com/orders", {
      method: "POST",
      body: "mutation",
    });

    const changed = await changeMethod(request, { method }, {});

    assert.equal(changed instanceof Request, true);
    assert.equal((changed as Request).body, null, method);
  }
});

test("basic authentication accepts case-insensitive and spaced schemes", async () => {
  for (const authorization of [
    `Basic ${btoa("alice:secret")}`,
    `Basic  ${btoa("alice:secret")}`,
    `basic ${btoa("alice:secret")}`,
  ]) {
    const response = await basicAuth(
      new Request("https://gateway.example.com/orders", {
        headers: { authorization },
      }),
      { secret: "BASIC_AUTH_ADMIN" },
      { BASIC_AUTH_ADMIN: "alice:secret" },
    );

    assert.equal(response instanceof Request, true, authorization);
  }
});

test("basic authentication accepts valid credentials", async () => {
  const response = await basicAuth(
    new Request("https://gateway.example.com/orders", {
      headers: { authorization: `Basic ${btoa("alice:secret")}` },
    }),
    { secret: "BASIC_AUTH_ADMIN" },
    { BASIC_AUTH_ADMIN: "alice:secret" },
  );

  assert.equal(response instanceof Request, true);
});

test("basic authentication encodes non-Latin-1 credentials as UTF-8", async () => {
  const token = btoa(String.fromCharCode(...new TextEncoder().encode("zoë:pässwörd✓")));
  const response = await basicAuth(
    new Request("https://gateway.example.com/orders", {
      headers: { authorization: `Basic ${token}` },
    }),
    { secret: "BASIC_AUTH_ADMIN" },
    { BASIC_AUTH_ADMIN: "zoë:pässwörd✓" },
  );

  assert.equal(response instanceof Request, true);
});

test("basic authentication returns 500 when the named secret is missing", async () => {
  const response = await basicAuth(
    new Request("https://gateway.example.com/orders", {
      headers: { authorization: `Basic ${btoa("alice:secret")}` },
    }),
    { secret: "BASIC_AUTH_ADMIN" },
    {},
  );

  assert.equal(response instanceof Response, true);
  assert.equal((response as Response).status, 500);
  assert.deepEqual(await (response as Response).json(), {
    message: "Basic auth configuration is missing",
  });
});
