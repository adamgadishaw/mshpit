import assert from "node:assert/strict";
import test from "node:test";

import { loadChunk } from "./lazyWithRetry.js";

// A fake sessionStorage and reload spy, so the recovery path is testable without
// a browser.
function harness() {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  let reloads = 0;
  return { storage, reload: () => { reloads += 1; }, reloadCount: () => reloads, delay: () => Promise.resolve(), store };
}

test("a chunk that loads first try returns it and leaves no reload guard", async () => {
  const h = harness();
  const mod = await loadChunk(async () => ({ default: "Screen" }), { name: "Ok", ...h });
  assert.equal(mod.default, "Screen");
  assert.equal(h.reloadCount(), 0);
  assert.equal(h.store.size, 0, "no guard left behind on success");
});

test("a transient blip is retried once and then succeeds without reloading", async () => {
  const h = harness();
  let attempts = 0;
  const mod = await loadChunk(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network blip");
    return { default: "Screen" };
  }, { name: "Blip", ...h });
  assert.equal(attempts, 2, "should have retried exactly once");
  assert.equal(mod.default, "Screen");
  assert.equal(h.reloadCount(), 0, "a recovered blip must not reload the page");
});

test("a stale chunk after a deploy reloads exactly once", async () => {
  const h = harness();
  const alwaysFails = async () => { throw new Error("Loading chunk failed: 404"); };
  const mod = await loadChunk(alwaysFails, { name: "Admin", ...h });
  assert.equal(h.reloadCount(), 1, "reloads to get fresh HTML");
  assert.equal(typeof mod.default, "function", "renders nothing while the reload happens");
  assert.equal(mod.default(), null);
});

test("it never loops: a second failure after the reload throws instead", async () => {
  const h = harness();
  const alwaysFails = async () => { throw new Error("still 404"); };
  // First load: reloads and returns the placeholder.
  await loadChunk(alwaysFails, { name: "Loop", ...h });
  assert.equal(h.reloadCount(), 1);
  // Second load with the guard already set (as it would be after the reload):
  // it must surface the error, not reload again.
  await assert.rejects(() => loadChunk(alwaysFails, { name: "Loop", ...h }), /still 404/);
  assert.equal(h.reloadCount(), 1, "must not reload a second time");
});

test("recovering one screen does not suppress a reload for a different screen", async () => {
  const h = harness();
  const fail = async () => { throw new Error("404"); };
  await loadChunk(fail, { name: "ScreenA", ...h });
  await loadChunk(fail, { name: "ScreenB", ...h });
  assert.equal(h.reloadCount(), 2, "each chunk gets its own one-shot reload");
});

test("a later success clears the guard so a future failure can recover again", async () => {
  const h = harness();
  const fail = async () => { throw new Error("404"); };
  await loadChunk(fail, { name: "Screen", ...h });     // reload #1, guard set
  assert.equal(h.store.get("pit.chunkReload.Screen"), "1");
  await loadChunk(async () => ({ default: "ok" }), { name: "Screen", ...h }); // recovers
  assert.equal(h.store.has("pit.chunkReload.Screen"), false, "guard cleared on success");
});
