import assert from "node:assert/strict";
import test from "node:test";
import {
  clientErrorSurface,
  normalizeClientCrashReport,
} from "./clientCrashReport.mjs";

test("client crash reports derive stable codes from a fixed kind", () => {
  assert.deepEqual(normalizeClientCrashReport({
    kind: "render",
    platform: "ios",
    surface: "artist",
    message: "private text",
    stack: "/private/path",
  }), {
    kind: "render",
    code: "PIT-APP-001",
    platform: "ios",
    surface: "artist",
  });
  assert.equal(normalizeClientCrashReport({ kind: "made-up" }), null);
});

test("unexpected client fields collapse to safe finite values", () => {
  assert.deepEqual(normalizeClientCrashReport({
    kind: "runtime",
    platform: "Safari on Adam's phone",
    surface: "search?q=private",
  }), {
    kind: "runtime",
    code: "PIT-APP-002",
    platform: "unknown",
    surface: "app",
  });
});

test("surface projection never exposes an entity id or query", () => {
  assert.equal(clientErrorSurface("/artists/secret-artist?token=private"), "artist");
  assert.equal(clientErrorSurface("/venues/history#fan-photo"), "venue");
  assert.equal(clientErrorSurface("/shows/tm-123"), "show");
  assert.equal(clientErrorSurface("/search?q=private"), "search");
  assert.equal(clientErrorSurface("/unknown/private/value"), "app");
});
