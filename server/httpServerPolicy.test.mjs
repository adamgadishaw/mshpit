import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HTTP_SERVER_LIMITS, applyHttpServerLimits } from "./httpServerPolicy.js";

test("HTTP connections have bounded headers, request bodies, reuse, and request counts", () => {
  assert.deepEqual(HTTP_SERVER_LIMITS, {
    headersTimeout: 15_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    maxHeadersCount: 100,
    maxRequestsPerSocket: 100,
  });
  assert.ok(HTTP_SERVER_LIMITS.headersTimeout > HTTP_SERVER_LIMITS.keepAliveTimeout);
  assert.ok(HTTP_SERVER_LIMITS.requestTimeout >= HTTP_SERVER_LIMITS.headersTimeout);

  const server = {};
  assert.equal(applyHttpServerLimits(server), server);
  for (const [property, value] of Object.entries(HTTP_SERVER_LIMITS)) {
    assert.equal(server[property], value);
    assert.ok(Number.isFinite(value) && value > 0);
  }

  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /applyHttpServerLimits\(server\);\s*\n\s*\/\/ Observe fatal errors/);
});
