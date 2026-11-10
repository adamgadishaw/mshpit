import assert from "node:assert/strict";
import test from "node:test";
import { createEndlessFeed } from "./endlessFeed.mjs";

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(initial = {}) {
  const timers = new Map(), calls = [];
  let id = 0, alive = true, changes = 0;
  const owner = createEndlessFeed({ changed: () => changes++, schedule: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, cancel: key => timers.delete(key) });
  let options = { enabled: true, ready: true, loading: false, sourceError: false, current: () => alive,
    visibleCount: 8, loadedCount: 8, rowsCount: 8, hasMore: true,
    reveal: () => { options = { ...options, visibleCount: options.visibleCount + 8, rowsCount: Math.min(options.visibleCount + 8, options.loadedCount) }; },
    load: () => new Promise((resolve, reject) => calls.push({ resolve, reject })), ...initial };
  const render = patch => { options = { ...options, ...patch }; owner.update(options); };
  render();
  return { owner, calls, timers, render, invalidate: () => { alive = false; }, get changes() { return changes; },
    measure: (content = 800, height = 800, offset = 0) => { owner.layout(height); owner.content(content); owner.scroll(offset); },
    tick() { assert.equal(timers.size, 1, "only one demand timer may be scheduled"); const [key, { fn, delay }] = [...timers][0]; timers.delete(key); fn(); return delay; } };
}

test("native duplicate end-reached events start one request and wait for new row measurements", async () => {
  const f = fixture(); f.measure(2400, 800, 1600);
  for (let i = 0; i < 20; i++) f.owner.end();
  assert.equal(f.tick(), 250); assert.equal(f.calls.length, 1);
  for (let i = 0; i < 20; i++) { f.owner.end(); f.render(); }
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  f.calls[0].resolve(true); await settle();
  f.render({ rowsCount: 16, visibleCount: 16, loadedCount: 20 });
  assert.equal(f.timers.size, 0, "do not use the old short content measurement for new rows");
  f.owner.content(4800); assert.equal(f.timers.size, 0, "new rows have moved the end away");
  f.owner.scroll(4000); assert.equal(f.tick(), 250); f.render();
  assert.equal(f.calls.length, 1, "reveal already-loaded matches without another request");
});

test("short filtered pages continue automatically with capped backoff through authoritative exhaustion", async () => {
  const f = fixture({ rowsCount: 0, visibleCount: 8, loadedCount: 0 });
  f.measure(400, 800);
  const delays = [];
  for (let page = 0; page < 7; page++) {
    delays.push(f.tick()); assert.equal(f.calls.length, page + 1);
    f.calls[page].resolve(true); await settle();
    f.render({ hasMore: page < 6 });
  }
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000, 4000, 4000]);
  assert.equal(f.timers.size, 0); assert.equal(f.owner.error, false);
  f.owner.end(); assert.equal(f.timers.size, 0, "exhausted cursor is authoritative even with zero matches");
});

test("visible progress and an explicit drag reset sparse-page backoff", async () => {
  const f = fixture({ rowsCount: 0, loadedCount: 0 }); f.measure(300, 800);
  f.tick(); f.calls[0].resolve(true); await settle(); f.render();
  assert.equal([...f.timers.values()][0].delay, 500);
  f.owner.interact(); assert.equal(f.tick(), 250);
  f.calls[1].resolve(true); await settle(); f.render({ rowsCount: 1, loadedCount: 1 });
  assert.equal(f.timers.size, 0); f.owner.content(600);
  assert.equal(f.tick(), 250);
});

test("failures stop every automatic trigger and explicit retry keeps the same demand", async () => {
  for (const throws of [false, true]) {
    const f = fixture(); f.measure(); f.tick();
    if (throws) f.calls[0].reject(Error("offline")); else f.calls[0].resolve(false);
    await settle(); f.render();
    f.owner.end(); f.owner.scroll(0); f.owner.content(800); f.owner.interact();
    assert.equal(f.owner.error, true); assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 1);
    f.owner.retry(); assert.equal(f.calls.length, 2);
    f.calls[1].resolve(true); await settle(); f.render({ hasMore: false });
    assert.equal(f.owner.error, false); assert.equal(f.timers.size, 0);
  }
});

test("hidden, preview, initial loading and refreshing owners cannot request or reveal", () => {
  for (const patch of [{ enabled: false }, { ready: false }, { loading: true }, { current: () => false }]) {
    const f = fixture(patch); f.measure(); f.owner.end(); f.owner.retry();
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  }
});

test("a retired account/filter/view ignores late responses and timers", async () => {
  const f = fixture(); f.measure(); f.tick(); f.invalidate();
  f.calls[0].resolve(false); await settle(); f.render(); f.owner.end(); f.owner.retry();
  assert.equal(f.owner.error, false); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
});

test("refresh invalidates a pending append without poisoning the refreshed head or releasing a newer lock", async () => {
  for (const throws of [false, true]) {
    const f = fixture(); f.measure(); f.tick();
    f.owner.reset(); f.render({ enabled: false });
    f.render({ enabled: true }); f.tick(); assert.equal(f.calls.length, 2);
    if (throws) f.calls[0].reject(Error("old error")); else f.calls[0].resolve(false);
    await settle(); f.render(); f.owner.end();
    assert.equal(f.owner.error, false); assert.equal(f.owner.loading, true); assert.equal(f.timers.size, 0);
    f.calls[1].resolve(true); await settle(); f.render({ hasMore: false });
    assert.equal(f.owner.error, false); assert.equal(f.owner.loading, false);
  }
});

test("effect cleanup/reconnect cancels work but allows fresh demand and fences the old completion", async () => {
  const f = fixture(); f.measure(); f.tick();
  f.owner.dispose(); assert.equal(f.timers.size, 0);
  f.owner.connect(); f.render(); f.tick();
  f.calls[0].resolve(false); await settle();
  assert.equal(f.owner.error, false); assert.equal(f.owner.loading, true);
  f.calls[1].resolve(true); await settle(); f.render({ hasMore: false });
  assert.equal(f.owner.loading, false);
});

test("continuous near-end scroll and rerenders retain the original pagination deadline", () => {
  const f = fixture(); f.measure(2400, 800, 1400);
  const first = [...f.timers.keys()][0];
  for (let i = 0; i < 30; i++) { f.owner.scroll(1400 + i); f.owner.end(); f.render(); }
  assert.equal([...f.timers.keys()][0], first, "scroll notifications must not debounce the deadline indefinitely");
  assert.equal(f.tick(), 250); assert.equal(f.calls.length, 1);
});

test("footer spinner layout cannot be mistaken for measurements of newly appended rows", async () => {
  const f = fixture(); f.measure(); f.tick();
  f.owner.content(850, 8);
  f.calls[0].resolve(true); await settle(); f.render({ rowsCount: 16, visibleCount: 16, loadedCount: 16 });
  assert.equal(f.timers.size, 0);
  f.owner.content(4000, 16); assert.equal(f.timers.size, 0);
  f.owner.scroll(3200); assert.equal(f.tick(), 250); assert.equal(f.calls.length, 2);
});

test("canceled timer callbacks cannot revive on reconnect or steal a fresh timer", () => {
  const f = fixture(); f.measure(); const old = [...f.timers.values()][0].fn;
  f.owner.dispose(); f.owner.connect(); f.render();
  const newKey = [...f.timers.keys()][0]; old();
  assert.equal(f.calls.length, 0); assert.equal([...f.timers.keys()][0], newKey);
  f.tick(); assert.equal(f.calls.length, 1);
});

test("source-error retry replays the failed read even with unrevealed cache or no cursor", async () => {
  for (const state of [{ loadedCount: 40, visibleCount: 8, rowsCount: 8, hasMore: true }, { loadedCount: 0, visibleCount: 8, rowsCount: 0, hasMore: false }]) {
    let reveals = 0;
    const f = fixture({ ...state, sourceError: true, reveal: () => reveals++ }); f.measure();
    assert.equal(f.timers.size, 0); f.owner.retry();
    assert.equal(reveals, 0); assert.equal(f.calls.length, 1);
    f.calls[0].resolve(true); await settle(); f.render({ sourceError: false, hasMore: false, loadedCount: 0, rowsCount: 0 });
    assert.equal(f.owner.error, false);
  }
});

test("a new active presentation replaces an obsolete scheduled timer without waiting for a hidden render", () => {
  let active = true;
  const f = fixture({ current: () => active }); f.measure();
  const old = [...f.timers.values()][0].fn;
  active = false; f.render({ current: () => true });
  const fresh = [...f.timers.keys()][0]; old();
  assert.equal([...f.timers.keys()][0], fresh); assert.equal(f.calls.length, 0);
  f.tick(); assert.equal(f.calls.length, 1);
});
