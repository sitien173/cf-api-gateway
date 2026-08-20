export class JsonResponse extends Response {
  constructor(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    super(JSON.stringify(body), {
      ...init,
      headers,
    });
  }
}

export class ErrorResponse extends JsonResponse {
  constructor(message: string, status = 500) {
    super({ message }, { status });
  }
}
