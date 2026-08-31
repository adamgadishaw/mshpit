import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const monitor = readFileSync(new URL("../components/RuntimeErrorMonitor.jsx", import.meta.url), "utf8");
const reporter = readFileSync(new URL("../lib/clientCrashReporter.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");

test("the app installs web runtime and rejected-promise monitoring", () => {
  assert.match(app, /<RuntimeErrorMonitor\s*\/>/);
  assert.match(monitor, /addEventListener\("error"/);
  assert.match(monitor, /addEventListener\("unhandledrejection"/);
  assert.match(monitor, /event\?\.target && event\.target !== window/);
  assert.match(monitor, /error\?\.name === "AbortError"/);
});

test("remote crash reports contain only categorical fields and omit account context", () => {
  assert.match(reporter, /credentials:\s*"omit"/);
  assert.match(reporter, /kind:\s*report\.kind/);
  assert.match(reporter, /platform:\s*report\.platform/);
  assert.match(reporter, /surface:\s*report\.surface/);
  for (const forbidden of ["message:", "stack:", "location.href", "session", "accountId", "userId"]) {
    assert.equal(reporter.includes(forbidden), false, forbidden + " must not be transmitted");
  }
});
