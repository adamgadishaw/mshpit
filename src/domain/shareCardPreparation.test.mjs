import assert from "node:assert/strict";
import test from "node:test";
import { prepareShareCardAsset, SHARE_CARD_PREPARATION_TIMEOUT_MS } from "./shareCardPreparation.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("share preparation returns the exact private asset before its bounded deadline", async () => {
  const asset = { previewUri: "blob:private-preview" };
  const released = [];
  assert.equal(SHARE_CARD_PREPARATION_TIMEOUT_MS, 15_000);
  assert.equal(await prepareShareCardAsset(() => asset, { release: (value) => released.push(value) }), asset);
  assert.deepEqual(released, [], "The mounted preview owns successful assets until cleanup");
});

test("ordinary failures, unexpected aborts, synchronous throws and empty rejections remain failures", async () => {
  for (const error of [new Error("Renderer failed"), Object.assign(new Error("Unexpected abort"), { name: "AbortError" }), null]) {
    await assert.rejects(prepareShareCardAsset(() => Promise.reject(error), { release() {} }), (actual) => actual === error);
  }
  const failure = new Error("Synchronous adapter failure");
  await assert.rejects(prepareShareCardAsset(() => { throw failure; }, { release() {} }), (actual) => actual === failure);
});

test("a transport that ignores abort still times out and releases its late asset exactly once", async () => {
  const pending = deferred(), released = [], failure = new Error("Preparation deadline");
  let childSignal;
  const result = prepareShareCardAsset(({ signal }) => { childSignal = signal; return pending.promise; }, {
    timeoutMs: 10, timeoutError: () => failure, release: (asset) => released.push(asset),
  });
  await assert.rejects(result, (error) => error === failure);
  assert.equal(childSignal.aborted, true);
  const late = { previewUri: "blob:late-private-preview" };
  pending.resolve(late); await settle();
  assert.deepEqual(released, [late]);
});

test("caller cancellation immediately settles an ignored transport and never adopts a late result", async () => {
  const controller = new AbortController(), pending = deferred(), released = [];
  let childSignal;
  const result = prepareShareCardAsset(({ signal }) => { childSignal = signal; return pending.promise; }, {
    signal: controller.signal, release: (asset) => released.push(asset),
  });
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(childSignal.aborted, true);
  const late = { fileUri: "file:///cache/late-private.png" };
  pending.resolve(late); await settle();
  assert.deepEqual(released, [late]);
});

test("an already cancelled lifecycle never starts work", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(prepareShareCardAsset(() => { calls += 1; }, { signal: controller.signal, release() {} }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("manual retry has its own lifecycle and an old result cannot displace it", async () => {
  const old = deferred(), released = [];
  await assert.rejects(prepareShareCardAsset(() => old.promise, { timeoutMs: 10, release: (asset) => released.push(asset) }));
  const current = { previewUri: "blob:retry" }, obsolete = { previewUri: "blob:obsolete" };
  assert.equal(await prepareShareCardAsset(() => current, { release: (asset) => released.push(asset) }), current);
  old.resolve(obsolete); await settle();
  assert.deepEqual(released, [obsolete]);
});

test("late cleanup failure does not create an unhandled rejection after the UI has settled", async () => {
  const late = deferred();
  await assert.rejects(prepareShareCardAsset(() => late.promise, { timeoutMs: 10, release() { throw new Error("Already removed"); } }));
  late.resolve({ previewUri: "blob:removed" }); await settle();
});

test("timeout factory failures still settle the preparation lifecycle", async () => {
  const failure = new Error("Deadline adapter failed");
  await assert.rejects(prepareShareCardAsset(() => new Promise(() => {}), {
    timeoutMs: 10, release() {}, timeoutError() { throw failure; },
  }), (actual) => actual === failure);
});
