import assert from "node:assert/strict";
import test from "node:test";
import {
  clientErrorSurface,
  clientCrashDiagnostic,
  clientCrashRequestId,
  normalizeClientCrashLocation,
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

const asset = "index-0123456789abcdef0123456789abcdef.js";
const origin = "https://app.example";

test("a browser error projects only allowlisted classification and an emitted-asset location", () => {
  const error = new ReferenceError("privateName is not defined");
  error.stack = `ReferenceError: privateName is not defined\n    at privateFunction (${origin}/_expo/static/js/web/${asset}:12:456)`;
  const diagnostic = clientCrashDiagnostic(error, { origin });
  assert.deepEqual(diagnostic, {
    errorType: "ReferenceError", diagnosis: "reference", location: { asset, line: 12, column: 456 },
  });
  assert.equal(JSON.stringify(diagnostic).includes("private"), false);
  assert.equal(JSON.stringify(diagnostic).includes(origin), false);
  error.stack = `privateFunction@${origin}/_expo/static/js/web/${asset}:3:10`;
  assert.deepEqual(clientCrashDiagnostic(error, { origin }).location, { asset, line: 3, column: 10 });
});

test("only known React invariant markers become diagnosis buckets", () => {
  for (const marker of [130, 185, 301, 310, 321]) {
    assert.deepEqual(clientCrashDiagnostic(new Error(`Minified React error #${marker}; args[]=private`)), {
      errorType: "Error", diagnosis: `react${marker}`,
    });
  }
  for (const message of ["Minified React error #123456; private", "private React error #310;"]) {
    assert.equal(clientCrashDiagnostic(new Error(message)).diagnosis, "unknown");
  }
  assert.deepEqual(clientCrashDiagnostic({ name: "privateName", message: "private" }), {
    errorType: "Unknown", diagnosis: "unknown",
  });
  assert.deepEqual(clientCrashDiagnostic({ get name() { throw Error("private"); } }), {
    errorType: "Unknown", diagnosis: "unknown",
  });
});

test("private, third-party, malformed and unbuilt stack locations are never projected", () => {
  for (const url of [
    `https://elsewhere.example/_expo/static/js/web/${asset}`,
    `${origin}/_expo/static/js/web/${asset}?token=private`,
    `${origin}/_expo/static/js/web/${asset}#private`,
    `${origin}/_expo/static/js/web/private.js`,
    `${origin}/_expo/static/js/web/nested/${asset}`,
    `${origin}/_expo/static/js/web/${asset}.map`,
    `${origin}/private/${asset}`,
    `file:///private/${asset}`,
    `https://private:secret@app.example/_expo/static/js/web/${asset}`,
  ]) {
    assert.equal(clientCrashDiagnostic({ name: "TypeError", stack: `    at private (${url}:1:23)` }, { origin }).location, undefined);
  }
  const messageOnly = { name: "Error", stack: `Error: private ${origin}/_expo/static/js/web/${asset}:1:2` };
  assert.equal(clientCrashDiagnostic(messageOnly, { origin }).location, undefined);
  assert.equal(clientCrashDiagnostic({ name: "Error", stack: `    at private (${origin}/_expo/static/js/web/${asset}:1:2)` }).location, undefined);
});

test("normalization strips extra values and rejects location path or coordinate tricks", () => {
  const value = { kind: "render", platform: "web", surface: "landing", errorType: "TypeError", diagnosis: "private", location: { asset, line: 1, column: 10, private: "secret" } };
  assert.deepEqual(normalizeClientCrashReport(value), {
    kind: "render", code: "PIT-APP-001", platform: "web", surface: "landing",
    errorType: "TypeError", diagnosis: "type", location: { asset, line: 1, column: 10 },
  });
  assert.equal(normalizeClientCrashReport({ ...value, errorType: "__proto__" }).errorType, undefined);
  assert.equal(normalizeClientCrashReport({ ...value, platform: "ios" }).location, undefined);
  for (const invalidAsset of [`../${asset}`, `${asset}?private`, `${asset}.map`, "private", `index-${"a".repeat(31)}.js`]) {
    assert.equal(normalizeClientCrashLocation({ asset: invalidAsset, line: 1, column: 2 }), null);
  }
  for (const coordinate of [0, -1, 0.1, NaN, Infinity, "1", 10_000_000, null]) {
    assert.equal(normalizeClientCrashLocation({ asset, line: coordinate, column: 2 }), null);
    assert.equal(normalizeClientCrashLocation({ asset, line: 1, column: coordinate }), null);
  }
});

test("support receipts accept only generated UUID-shaped request references", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(clientCrashRequestId(uuid), uuid);
  for (const value of ["private", ` ${uuid}`, uuid + "?private", null, {}]) assert.equal(clientCrashRequestId(value), null);
});
