import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clientCrashCause, resolveClientCrashLocation } from "./clientCrashLocation.js";

const asset = "index-0123456789abcdef0123456789abcdef.js";
const location = { asset, line: 12, column: 456 };
const CAUSE_RE = /^[A-Za-z][A-Za-z0-9_.]{0,38}(\/[A-Za-z0-9_.]{1,38})?$/;

function directoryFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "pit-crash-location-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, asset), "compiled fixture");
  return directory;
}

test("only actual emitted JS assets can contribute a persisted location", (t) => {
  const directory = directoryFixture(t);
  const suffix = resolveClientCrashLocation(location, directory);
  assert.equal(suffix, `b${BigInt("0x0123456789abcdef0123456789abcdef").toString(36)}.c.co`);
  assert.equal(resolveClientCrashLocation({ ...location, asset: "index-00000000000000000000000000000000.js" }, directory), null);
  assert.equal(resolveClientCrashLocation({ ...location, asset: `../${asset}` }, directory), null);
  assert.equal(resolveClientCrashLocation({ ...location, asset: `${asset}.map` }, directory), null);
  const directoryAsset = "chunk-ffffffffffffffffffffffffffffffff.js";
  mkdirSync(join(directory, directoryAsset));
  assert.equal(resolveClientCrashLocation({ ...location, asset: directoryAsset }, directory), null);
});

test("full asset hash and coordinate extremes fit the existing safe cause field", (t) => {
  const directory = directoryFixture(t);
  const largestAsset = "chunk-ffffffffffffffffffffffffffffffff.js";
  writeFileSync(join(directory, largestAsset), "compiled fixture");
  const report = { platform: "web", errorType: "AggregateError", diagnosis: "react310", location: { asset: largestAsset, line: 9_999_999, column: 9_999_999 } };
  const cause = clientCrashCause("RuntimeError.Web", report, (value) => resolveClientCrashLocation(value, directory));
  assert.match(cause, CAUSE_RE);
  assert.equal(cause.split("/")[1].length, 38);
  const [hash, line, column] = cause.split("/")[1].split(".");
  let restored = 0n;
  for (const digit of hash.slice(1)) restored = restored * 36n + BigInt(parseInt(digit, 36));
  assert.equal(restored.toString(16), "f".repeat(32));
  assert.equal(parseInt(line, 36), 9_999_999);
  assert.equal(parseInt(column, 36), 9_999_999);
});

test("native and legacy crashes retain bounded class-only identities", () => {
  assert.equal(clientCrashCause("RenderError.Web", { platform: "web" }), "RenderError.Web");
  const cause = clientCrashCause("RuntimeError.Unknown", { platform: "unknown", errorType: "AggregateError", diagnosis: "react310" });
  assert.match(cause, CAUSE_RE);
  assert.equal(cause, "RuntimeError.Unknown.Aggregate.react310");
  assert.equal(clientCrashCause("RenderError.Ios", { platform: "ios", errorType: "TypeError", location }, () => { throw Error("must not resolve native locations"); }), "RenderError.Ios.Type");
});
