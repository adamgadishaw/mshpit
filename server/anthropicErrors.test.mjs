import assert from "node:assert/strict";
import test from "node:test";

import { anthropicErrorSummary } from "./anthropicErrors.js";

test("a failed Anthropic call logs its status, type and reason, never a key", () => {
  // The SDK shape: the parsed response body on error.error.
  const sdk = Object.assign(new Error("400"), { status: 400, error: { type: "error", error: {
    type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API.",
  } } });
  assert.equal(anthropicErrorSummary(sdk),
    'status=400 type=invalid_request_error detail="Your credit balance is too low to access the Anthropic API."');
  // Raw fetch callers attach the body's error object.
  const raw = Object.assign(new Error("x"), { status: 401, anthropicError: { type: "authentication_error", message: "invalid x-api-key sk-ant-api03-SECRETvalue_1" } });
  assert.equal(anthropicErrorSummary(raw), 'status=401 type=authentication_error detail="invalid x-api-key [key]"');
  assert.equal(anthropicErrorSummary(new Error("network down")), "");
  assert.ok(anthropicErrorSummary({ status: 400, error: { error: { type: "x", message: "a".repeat(500) + "<script>" } } }).length < 230);
});
