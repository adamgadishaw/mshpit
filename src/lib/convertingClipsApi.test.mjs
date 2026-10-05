import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { createConvertingClipPoller } from "./convertingClipPoller.mjs";

const require = createRequire(import.meta.url);
const code = transformSync(readFileSync(new URL("./convertingClipsApi.js", import.meta.url), "utf8"), {
  babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;
function fixture(result, fail = false) {
  const calls = [], module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => name === "./api"
    ? { api: async (...args) => { calls.push(args); if (fail) throw Error("network"); return result; } }
    : { createConvertingClipPoller }, module, module.exports);
  return { ...module.exports, calls };
}

test("asset reads preserve account/signal boundary, bounded timeout and encoded identity", async () => {
  const signal = new AbortController().signal, f = fixture({ asset: { status: "ready" } });
  assert.equal(await f.checkConvertingClip("a/b", { accountId: "owner", signal }), "ready");
  assert.equal(f.calls[0][0], "/api/media/assets/a%2Fb");
  assert.equal(f.calls[0][1].expectedAccountId, "owner"); assert.equal(f.calls[0][1].signal, signal);
  assert.equal(f.calls[0][1].timeoutMs, 10_000);
});

test("only authoritative completion/failure changes processing state", async () => {
  for (const [result, state] of [[{ finalize: { state: "completed" } }, "ready"], [{ finalize: { state: "failed" } }, "failed"], [{}, "processing"]]) {
    assert.equal(await fixture(result).checkConvertingClip("clip", { accountId: "owner" }), state);
  }
  assert.equal(await fixture({}, true).checkConvertingClip("clip", { accountId: "owner" }), "processing");
});

test("explicit retry retains owner identity and cancellation, and exposes refused writes", async () => {
  const signal = new AbortController().signal, f = fixture({ finalize: { state: "completed" } });
  assert.equal(await f.retryConvertingClip("clip", { accountId: "owner", signal }), "ready");
  assert.equal(f.calls[0][1].method, "POST"); assert.equal(f.calls[0][1].expectedAccountId, "owner");
  assert.equal(f.calls[0][1].signal, signal); assert.equal(f.calls[0][1].timeoutMs, 10_000);
  await assert.rejects(fixture({}, true).retryConvertingClip("clip", { accountId: "owner" }), /network/);
});
