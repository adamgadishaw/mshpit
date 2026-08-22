import assert from "node:assert/strict";
import test from "node:test";

import {
  commandFailure,
  commandSuccess,
  isAppErrorLike,
} from "./commandResult.mjs";

function appError(code = "PIT-REQ-001") {
  const error = new Error("Public-safe failure");
  error.name = "AppError";
  error.code = code;
  error.retryable = false;
  return error;
}

test("commands have one discriminated success and failure algebra", () => {
  const success = commandSuccess({ id: "confirmed" });
  const failureError = appError();
  const failure = commandFailure(failureError);

  assert.deepEqual(success, { ok: true, value: { id: "confirmed" } });
  assert.deepEqual(failure, { ok: false, error: failureError });
  assert.equal(success.ok, true);
  assert.equal(Object.hasOwn(success, "error"), false);
  assert.equal(failure.ok, false);
  assert.equal(failure.error, failureError);
  assert.equal(Object.hasOwn(failure, "value"), false);
});

test("raw errors cannot masquerade as command failures", () => {
  assert.equal(isAppErrorLike(new Error("raw")), false);
  assert.throws(() => commandFailure(new Error("raw")), /require an AppError/);
});
