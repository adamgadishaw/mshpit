import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedAccount } from "./identityBinding.js";

test("expected-account binding rejects an A tab when the shared cookie is B", () => {
  assert.doesNotThrow(() => assertExpectedAccount("u_a", { id: "u_a" }));
  assert.doesNotThrow(() => assertExpectedAccount("guest", null));
  assert.throws(
    () => assertExpectedAccount("u_a", { id: "u_b" }),
    (error) => error.status === 409 && error.code === "IDENTITY_CHANGED",
  );
  assert.throws(
    () => assertExpectedAccount("guest", { id: "u_b" }),
    (error) => error.status === 409 && error.code === "IDENTITY_CHANGED",
  );
});
