import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fatal process errors retain Node's fail-fast behavior", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /process\.on\("uncaughtExceptionMonitor"/);
  assert.doesNotMatch(source, /process\.on\(["']uncaughtException["']\s*,/);
  assert.doesNotMatch(source, /process\.on\(["']unhandledRejection["']\s*,/);
});

test("missing hashed assets return 404 instead of the SPA shell", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /pathname\.startsWith\("\/_expo\/"\).*return send\(res, 404/);
});
