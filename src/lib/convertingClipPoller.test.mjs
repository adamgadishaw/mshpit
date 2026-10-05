import assert from "node:assert/strict";
import test from "node:test";
import { createConvertingClipPoller, convertingClipPollDelay } from "./convertingClipPoller.mjs";

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture(check = async () => "processing") {
  let time = 0, serial = 0;
  const timers = new Map(), reads = [], states = [], refreshes = [];
  const poller = createConvertingClipPoller({ now: () => time,
    setTimer(fn, ms) { const id = ++serial; timers.set(id, { at: time + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    check: (id, options) => { reads.push({ id, ...options, at: time }); return check(id, options); },
  });
  const advance = async (ms = 0) => {
    const target = time + ms;
    for (let count = 0; count < 1000; count++) {
      await flush();
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) { time = target; await flush(); return; }
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    assert.fail("scheduler must not spin");
  };
  const subscribe = (overrides = {}) => poller.subscribe({ accountId: "owner", assetId: "clip",
    onState: (state) => states.push(state), onReady: async ({ signal }) => { refreshes.push(signal); return true; }, ...overrides });
  return { poller, timers, reads, states, refreshes, subscribe, advance };
}

test("immediate check, short initial cadence and bounded long-running backoff", async () => {
  const f = fixture(); const stop = f.subscribe();
  await f.advance(150_000);
  assert.deepEqual(f.reads.map((read) => read.at), [0, ...Array.from({ length: 15 }, (_, i) => (i + 1) * 2000),
    ...Array.from({ length: 18 }, (_, i) => 35_000 + i * 5000), 135_000, 150_000]);
  assert.equal(convertingClipPollDelay(29_999), 2000);
  assert.equal(convertingClipPollDelay(30_000), 5000);
  assert.equal(convertingClipPollDelay(120_000), 15_000);
  stop(); assert.equal(f.timers.size, 0);
});

test("ready at seven seconds is observed at eight and retired only after accepted refresh", async () => {
  let ready = false;
  const refreshed = deferred();
  const f = fixture(async () => ready ? "ready" : "processing");
  f.subscribe({ onReady: () => refreshed.promise });
  await f.advance(7000); ready = true; await f.advance(1000);
  assert.deepEqual(f.reads.map((read) => read.at), [0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(f.states, []);
  refreshed.resolve(true); await f.advance();
  assert.deepEqual(f.states, ["ready"]); assert.equal(f.timers.size, 0);
});

test("duplicate cards share one flight and timer; removing one retains the other's request", async () => {
  const result = deferred(), second = [];
  const f = fixture(() => result.promise);
  const stop1 = f.subscribe(), stop2 = f.subscribe({ onState: (state) => second.push(state) });
  await f.advance(60_000); assert.equal(f.reads.length, 1);
  stop1(); assert.equal(f.reads[0].signal.aborted, false);
  result.resolve("ready"); await f.advance();
  assert.deepEqual(f.states, []); assert.deepEqual(second, ["ready"]);
  assert.equal(f.refreshes.length, 1); stop2(); assert.equal(f.timers.size, 0);
});

test("at most two reads run at once across different clips", async () => {
  const pending = [deferred(), deferred(), deferred()];
  const f = fixture((id) => pending[Number(id)].promise);
  const stops = pending.map((_, i) => f.subscribe({ assetId: String(i) }));
  await f.advance(20_000); assert.deepEqual(f.reads.map((read) => read.id), ["0", "1"]);
  pending[0].resolve("failed"); await f.advance();
  assert.deepEqual(f.reads.map((read) => read.id), ["0", "1", "2"]);
  stops.forEach((stop) => stop());
  assert.ok(f.reads.slice(1).every((read) => read.signal.aborted));
  pending[1].resolve("ready"); pending[2].resolve("ready"); await f.advance();
  assert.deepEqual(f.states, ["failed"]); assert.equal(f.timers.size, 0);
});

test("hidden/unmounted last subscriber aborts and fences a transport that resolves late", async () => {
  const result = deferred(); const f = fixture(() => result.promise);
  const stop = f.subscribe(); await f.advance(); stop();
  assert.equal(f.reads[0].signal.aborted, true);
  f.subscribe(); result.resolve("ready"); await f.advance();
  assert.deepEqual(f.states, []); assert.equal(f.refreshes.length, 0);
  assert.equal(f.reads.length, 1, "replacement cannot overlap the settling read");
});

test("hide/show keeps long-running backoff age and performs no hidden work", async () => {
  const f = fixture(); let stop = f.subscribe(); await f.advance(120_000);
  stop(); const count = f.reads.length; await f.advance(40_000);
  assert.equal(f.reads.length, count);
  stop = f.subscribe(); await f.advance();
  assert.equal(f.reads.at(-1).at, 160_000);
  await f.advance(14_999); assert.equal(f.reads.length, count + 1);
  await f.advance(1); assert.equal(f.reads.length, count + 2); stop();
});

test("server failure stops; transient read failure backs off; explicit retry resets", async () => {
  let attempt = 0;
  const f = fixture(async () => { if (++attempt === 1) throw Error("offline"); return "failed"; });
  const stop = f.subscribe(); await f.advance(10_000);
  assert.equal(attempt, 2); assert.deepEqual(f.states, ["failed"]); assert.equal(f.timers.size, 0);
  f.poller.retryAccepted("owner", "clip"); await f.advance();
  assert.equal(attempt, 3); assert.deepEqual(f.states, ["failed", "processing", "failed"]); stop();
});

test("busy/failed feed refresh retries without re-reading an already-ready asset", async () => {
  let attempt = 0; const f = fixture(async () => "ready");
  f.subscribe({ onReady: async () => [null, false, true][attempt++] });
  await f.advance(3999); assert.deepEqual(f.states, []);
  await f.advance(1); assert.deepEqual(f.states, ["ready"]);
  assert.equal(attempt, 3); assert.equal(f.reads.length, 1);
});

test("ready clips coalesce feed refresh and keep it alive when one card disappears", async () => {
  const result = deferred(); let calls = 0;
  const f = fixture(async () => "ready");
  const stop = f.subscribe({ onReady: () => { calls++; return result.promise; } });
  f.subscribe({ assetId: "second", onReady: () => { calls++; return true; } });
  await f.advance(); assert.equal(calls, 1);
  stop(); result.resolve(true); await f.advance();
  assert.deepEqual(f.states, ["ready"]); assert.equal(calls, 1);
});

test("a clip that becomes ready during a refresh needs a later feed snapshot", async () => {
  const firstRefresh = deferred(); let calls = 0;
  const f = fixture(async () => "ready");
  f.subscribe({ onReady: () => { calls++; return firstRefresh.promise; } });
  await f.advance();
  f.subscribe({ assetId: "later", onReady: async () => { calls++; return true; } });
  await f.advance(); assert.equal(calls, 1); assert.deepEqual(f.states, []);
  firstRefresh.resolve(true); await f.advance();
  assert.equal(calls, 2); assert.deepEqual(f.states, ["ready", "ready"]);
});

test("account replacement aborts old work and never publishes its result", async () => {
  const result = deferred(); let current = true;
  const f = fixture((_id, { accountId }) => accountId === "old" ? result.promise : "failed");
  f.subscribe({ accountId: "old", isCurrent: () => current }); await f.advance(); current = false;
  f.subscribe({ accountId: "new" }); await f.advance();
  assert.equal(f.reads[0].signal.aborted, true);
  assert.deepEqual(f.reads.map((read) => read.accountId), ["old", "new"]);
  result.resolve("ready"); await f.advance(); assert.deepEqual(f.states, ["failed"]);
});

test("idle terminal entries expire even when resubscribing to the same key", async () => {
  const f = fixture(async () => "failed"); const stop = f.subscribe(); await f.advance(); stop();
  await f.advance(300_000); f.subscribe(); await f.advance();
  assert.equal(f.reads.length, 2);
});

test("fresh server-processing projection revalidates cached failure after another-tab retry", async () => {
  let state = "failed";
  const f = fixture(async () => state); const stop = f.subscribe(); await f.advance(); stop();
  state = "ready"; f.subscribe(); await f.advance();
  assert.equal(f.reads.length, 2); assert.deepEqual(f.states, ["failed", "ready"]);
});

test("failed duplicate cards passively share an explicit retry and its completion", async () => {
  const f = fixture(async () => "ready"), other = [];
  f.subscribe({ state: "failed" }); f.subscribe({ state: "failed", onState: (state) => other.push(state) });
  await f.advance(10_000); assert.equal(f.reads.length, 0);
  f.poller.retryAccepted("owner", "clip"); await f.advance();
  assert.equal(f.reads.length, 1); assert.equal(f.refreshes.length, 1);
  assert.deepEqual(f.states, ["processing", "ready"]); assert.deepEqual(other, ["processing", "ready"]);
});
