import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIOSInboxLoad } from "./iosInboxLoad.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

for (const initiatingInteractive of [false, true]) {
  const initiator = initiatingInteractive ? "manual refresh" : "poll";
  const joiner = initiatingInteractive ? "poll" : "manual refresh";
  test(`joined ${joiner} abort leaves initiating ${initiator} alive`, async () => {
    const states = [];
    const loader = createIOSInboxLoad((status) => states.push(status));
    const pending = deferred();
    const owner = new AbortController();
    const joining = new AbortController();
    let requestSignal;
    let calls = 0;
    const load = ({ signal }) => { calls += 1; requestSignal = signal; return pending.promise; };
    const first = loader.run({ load, signal: owner.signal, interactive: initiatingInteractive });
    const second = loader.run({ load, signal: joining.signal, interactive: !initiatingInteractive });
    assert.equal(first, second);
    await Promise.resolve();
    joining.abort();
    assert.equal(requestSignal.aborted, false);
    assert.equal(owner.signal.aborted, false);
    assert.equal(calls, 1);
    const rows = [{ otherId: "member" }];
    pending.resolve(rows);
    assert.deepEqual(await Promise.all([first, second]), [rows, rows]);
    assert.deepEqual(states, initiatingInteractive ? ["loading", "ready"] : ["ready"]);
  });

  for (const cancelScope of [false, true]) {
    test(`${cancelScope ? "loader.cancel" : `initiating ${initiator} abort`} cancels the shared read for both callers`, async () => {
      const states = [];
      const loader = createIOSInboxLoad((status) => states.push(status));
      const owner = new AbortController();
      const joining = new AbortController();
      let requestSignal;
      let calls = 0;
      const load = ({ signal }) => {
        calls += 1;
        requestSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { name: "AbortError" })), { once: true });
        });
      };
      const first = loader.run({ load, signal: owner.signal, interactive: initiatingInteractive });
      const second = loader.run({ load, signal: joining.signal, interactive: !initiatingInteractive });
      assert.equal(first, second);
      const settled = Promise.allSettled([first, second]);
      await Promise.resolve();
      if (cancelScope) loader.cancel();
      else owner.abort();
      assert.equal(requestSignal.aborted, true);
      assert.equal(calls, 1);
      for (const result of await settled) {
        assert.equal(result.status, "rejected");
        assert.equal(result.reason.name, "AbortError");
      }
      assert.ok(!states.includes("ready") && !states.includes("error"));
      if (cancelScope) assert.deepEqual(states, initiatingInteractive ? ["loading"] : []);
    });
  }
}

test("initial failure differs from successful empty and retry recovers", async () => {
  const states = [];
  const loader = createIOSInboxLoad((status) => states.push(status));
  await assert.rejects(loader.run({ load: async ({ strict }) => { assert.equal(strict, true); throw new Error("offline"); } }));
  assert.deepEqual(states, ["error"]);
  await loader.run({ interactive: true, load: async () => [] });
  assert.deepEqual(states, ["error", "loading", "ready"]);
});

test("poll and repeated retry share one request, with interactive failure visible", async () => {
  const states = [];
  const loader = createIOSInboxLoad((status) => states.push(status));
  await loader.run({ load: async () => [] });
  const pending = deferred();
  let calls = 0;
  const load = () => { calls += 1; return pending.promise; };
  const poll = loader.run({ load });
  assert.equal(loader.run({ load, interactive: true }), poll);
  assert.equal(loader.run({ load, interactive: true }), poll);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.reject(new Error("offline"));
  await assert.rejects(poll);
  assert.deepEqual(states, ["ready", "error"]);
});

test("background failure after a successful read is quiet and recovery clears error", async () => {
  const states = [];
  const loader = createIOSInboxLoad((status) => states.push(status));
  await loader.run({ load: async () => [{ otherId: "cached" }] });
  await assert.rejects(loader.run({ load: async () => { throw new Error("offline"); } }));
  assert.deepEqual(states, ["ready"]);
  await assert.rejects(loader.run({ interactive: true, load: async () => { throw new Error("offline"); } }));
  await loader.run({ load: async () => [] });
  assert.deepEqual(states, ["ready", "loading", "error", "ready"]);
});

test("cancel aborts old scope and fences completion even if loader ignores abort", async () => {
  const states = [];
  const loader = createIOSInboxLoad((status) => states.push(status));
  const pending = deferred();
  let signal;
  const old = loader.run({ load: (options) => { signal = options.signal; return pending.promise; } });
  await Promise.resolve();
  loader.cancel();
  assert.equal(signal.aborted, true);
  await loader.run({ load: async () => [] });
  pending.resolve([]);
  await old;
  assert.deepEqual(states, ["ready"]);
});

test("aborted interactive read restores previous successful state without failure", async () => {
  const states = [];
  const loader = createIOSInboxLoad((status) => states.push(status));
  await loader.run({ load: async () => [] });
  const pending = deferred();
  const controller = new AbortController();
  const request = loader.run({ signal: controller.signal, interactive: true, load: () => pending.promise });
  await Promise.resolve();
  controller.abort();
  pending.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
  await assert.rejects(request);
  assert.deepEqual(states, ["ready", "loading", "ready"]);
});

test("Inbox gates recovery to iOS and keeps its sole live-chat poll", () => {
  const source = readFileSync(new URL("../screens/InboxScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /const isIOS = Platform\.OS === "ios"/);
  assert.equal((source.match(/useLiveChat\(/g) || []).length, 1);
  assert.match(source, /: loadInboxThreads\(\{ signal \}\)/);
  assert.match(source, /: loadInboxThreads\(\{ signal, strict: true \}\)/);
  assert.match(source, /inboxStatus=\{isIOS \? inboxStatus : "ready"\}/);
  assert.match(source, /inboxScopeRef\.current === inboxRefreshScope/);
  assert.match(source, /threads=\{threads\}/);
});

test("aborted loader that resolves cannot prove empty or leave retry loading", async () => {
  const states = [];
  const loader = createIOSInboxLoad((status) => states.push(status));
  await assert.rejects(loader.run({ load: async () => { throw new Error("offline"); } }));
  const pending = deferred();
  const controller = new AbortController();
  const request = loader.run({ signal: controller.signal, interactive: true, load: () => pending.promise });
  await Promise.resolve();
  controller.abort();
  pending.resolve([]);
  await request;
  assert.deepEqual(states, ["error", "loading", "error"]);
});
