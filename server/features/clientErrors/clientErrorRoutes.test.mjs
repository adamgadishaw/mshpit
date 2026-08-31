import assert from "node:assert/strict";
import test from "node:test";
import { clientErrorRoutes } from "./clientErrorRoutes.js";

class TestApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fixture() {
  const recorded = [];
  const limits = [];
  let alerts = 0;
  const routes = clientErrorRoutes({
    ApiError: TestApiError,
    rateLimit: (...args) => limits.push(args),
    recordError: (entry) => {
      recorded.push(entry);
      return "fingerprint";
    },
    onRecorded: () => { alerts += 1; },
  });
  const headers = {};
  return {
    handler: routes["POST /api/client-errors"],
    recorded,
    limits,
    headers,
    alerts: () => alerts,
    ctx: {
      body: { kind: "render", platform: "ios", surface: "artist", message: "private" },
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      setHeader: (key, value) => { headers[key] = value; },
    },
  };
}

test("client error ingestion stores only a finite operational fingerprint", () => {
  const f = fixture();
  assert.deepEqual(f.handler(f.ctx), { ok: true });
  assert.equal(f.limits.length, 2);
  assert.equal(f.headers["Cache-Control"], "no-store");
  assert.equal(f.alerts(), 1);
  assert.deepEqual(f.recorded, [{
    level: "fatal",
    code: "PIT-APP-001",
    status: 0,
    method: "POST",
    route: "/client/artist",
    cause: "RenderError.Ios",
    requestId: f.ctx.requestId,
  }]);
  assert.equal(JSON.stringify(f.recorded).includes("private"), false);
});

test("client error ingestion rejects unknown crash kinds", () => {
  const f = fixture();
  assert.throws(
    () => f.handler({ ...f.ctx, body: { kind: "sql", platform: "web", surface: "artist" } }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.equal(f.recorded.length, 0);
  assert.equal(f.alerts(), 0);
});

test("unhandled promises remain serious without being mislabeled fatal", () => {
  const f = fixture();
  f.handler({ ...f.ctx, body: { kind: "promise", platform: "web", surface: "feed" } });
  assert.equal(f.recorded[0].level, "error");
  assert.equal(f.recorded[0].code, "PIT-APP-003");
});
