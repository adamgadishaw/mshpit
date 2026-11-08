import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createIOSAccessibilityPreference } from "./iosAccessibilityPreference.mjs";
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture() {
  const events = [], pending = []; let removals = 0, reads = 0;
  const store = createIOSAccessibilityPreference({
    read: () => { reads++; return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    listen: callback => { events.push(callback); return { remove: () => { removals++; } }; },
  });
  return { store, events, pending, counts: () => ({ removals, reads }) };
}

test("iOS disables custom gestures/motion until initial accessibility read settles", async () => {
  const f = fixture(); let changes = 0;
  assert.equal(f.store.getSnapshot(), true); assert.equal(f.store.getServerSnapshot(), true);
  const stop = f.store.subscribe(() => changes++); await flush();
  f.pending[0].resolve(false); await flush();
  assert.equal(f.store.getSnapshot(), false); assert.equal(changes, 1); stop();
});

test("a newer accessibility event wins over a stale initial query", async () => {
  const f = fixture(), stop = f.store.subscribe(() => {}); await flush();
  f.events[0](false); f.events[0](true); f.pending[0].resolve(false); await flush();
  assert.equal(f.store.getSnapshot(), true); stop();
});

test("same-value events still invalidate old queries and rejected reads never override live state", async () => {
  for (const reject of [true, false]) {
    const f = fixture(), stop = f.store.subscribe(() => {}); await flush();
    f.events[0](true);
    if (reject) f.pending[0].reject(new Error("unavailable")); else f.pending[0].resolve(false);
    await flush(); assert.equal(f.store.getSnapshot(), true); stop();
  }
});

test("all mounted consumers share one subscription and last unmount removes it", async () => {
  const f = fixture(); let a = 0, b = 0;
  const stopA = f.store.subscribe(() => a++), stopB = f.store.subscribe(() => b++);
  await flush(); assert.equal(f.events.length, 1); assert.equal(f.counts().reads, 1);
  f.events[0](false); assert.equal(a, 1); assert.equal(b, 1);
  stopA(); assert.equal(f.counts().removals, 0); f.events[0](true); assert.equal(a, 1); assert.equal(b, 2);
  stopB(); assert.equal(f.counts().removals, 1);
});

test("late callbacks after unmount cannot affect a later subscription", async () => {
  const f = fixture(), stopA = f.store.subscribe(() => {}); await flush(); stopA();
  const stopB = f.store.subscribe(() => {}); await flush();
  f.events[1](false); f.events[0](true); f.pending[0].resolve(true); await flush();
  assert.equal(f.store.getSnapshot(), false);
  f.pending[1].resolve(true); await flush(); assert.equal(f.store.getSnapshot(), false); stopB();
});

test("synchronous lookup failures retain conservative accessibility state", async () => {
  const store = createIOSAccessibilityPreference({ read: () => { throw new Error("unavailable"); }, listen: () => ({ remove() {} }) });
  const stop = store.subscribe(() => {}); await flush(); assert.equal(store.getSnapshot(), true); stop();
});

test("only iOS hook entries use the race-safe preference store", () => {
  for (const [name, event, method] of [["useScreenReaderEnabled", "screenReaderChanged", "isScreenReaderEnabled"], ["useReducedMotion", "reduceMotionChanged", "isReduceMotionEnabled"]]) {
    const ios = readFileSync(new URL(`./${name}.ios.js`, import.meta.url), "utf8");
    assert.match(ios, /useSyncExternalStore\(preference\.subscribe, preference\.getSnapshot, preference\.getServerSnapshot\)/);
    assert.ok(ios.includes(event) && ios.includes(method));
    const other = readFileSync(new URL(`./${name}.js`, import.meta.url), "utf8");
    assert.ok(!other.includes("createIOSAccessibilityPreference"));
  }
});
