import assert from "node:assert/strict";
import test from "node:test";

import { apiBaseForRuntime, PRODUCTION_API_ORIGIN } from "./apiOrigin.mjs";

test("production web stays same-origin even when a public variable is present", () => {
  assert.equal(apiBaseForRuntime({
    platform: "web",
    configuredOrigin: "https://attacker.example",
  }), "");
});

test("native release builds fail safely to the canonical HTTPS API", () => {
  for (const configuredOrigin of [
    "http://www.mshpit.com",
    "https://attacker.example",
    "https://www.mshpit.com.evil.example",
    "https://user:pass@www.mshpit.com",
    "https://www.mshpit.com/private",
  ]) {
    assert.equal(apiBaseForRuntime({ platform: "ios", configuredOrigin }), PRODUCTION_API_ORIGIN);
  }
  assert.equal(apiBaseForRuntime({
    platform: "android",
    configuredOrigin: "https://www.mshpit.com",
  }), PRODUCTION_API_ORIGIN);
});

test("development native builds can explicitly use a local HTTP API", () => {
  assert.equal(apiBaseForRuntime({
    platform: "ios",
    configuredOrigin: "http://127.0.0.1:3000",
    development: true,
  }), "http://127.0.0.1:3000");
  assert.equal(apiBaseForRuntime({
    platform: "ios",
    configuredOrigin: "http://attacker.example:3000",
    development: true,
  }), PRODUCTION_API_ORIGIN);
});
