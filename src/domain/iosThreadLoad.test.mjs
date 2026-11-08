import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { createIOSThreadLoad } from "./iosThreadLoad.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const offline = async () => { throw new Error("offline"); };

test("strict initial failure is not empty; retry establishes history and background failures stay quiet", async () => {
  const states = [];
  const loader = createIOSThreadLoad(s => states.push(s));
  await assert.rejects(loader.run({ load: async ({ strict }) => { assert.equal(strict, true); return offline(); } }));
  assert.deepEqual(states, ["error"]);
  await loader.run({ interactive: true, load: async () => ({ syncCursor: null, hasMore: false }) });
  await assert.rejects(loader.run({ after: "cursor", load: offline }));
  assert.deepEqual(states, ["error", "loading", "ready"]);
  await assert.rejects(loader.run({ interactive: true, load: offline }));
  await loader.run({ after: "cursor", load: async () => ({ syncCursor: "next" }) });
  assert.deepEqual(states.slice(-3), ["loading", "error", "ready"]);
});

test("incremental metadata alone cannot establish initial history", async () => {
  const states = [];
  const loader = createIOSThreadLoad(s => states.push(s));
  await assert.rejects(loader.run({ load: offline }));
  await loader.run({ after: "cursor", load: async () => ({ relationshipContext: {}, syncCursor: "next" }) });
  assert.deepEqual(states, ["error"]);
});

test("full refresh and incremental poll serialize and each retain their cursor/context semantics", async () => {
  const loader = createIOSThreadLoad(() => {});
  const pending = deferred();
  const calls = [];
  const load = options => { calls.push(options); return calls.length === 1 ? pending.promise : { syncCursor: "full", hasMore: false }; };
  const poll = loader.run({ after: "old", load });
  const refresh = loader.run({ forceContext: true, interactive: true, load });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  pending.resolve({ syncCursor: "incremental", hasMore: true });
  assert.deepEqual(await poll, { syncCursor: "incremental", hasMore: true });
  assert.deepEqual(await refresh, { syncCursor: "full", hasMore: false });
  assert.equal(calls[0].after, "old");
  assert.equal(calls[1].after, null);
  assert.equal(calls[1].forceContext, true);
  assert.ok(calls.every(call => call.strict));
});

test("only matching cursor and context requests join; joining caller cannot abort owner", async () => {
  const loader = createIOSThreadLoad(() => {});
  const pending = deferred();
  const owner = new AbortController(), joiner = new AbortController();
  let calls = 0;
  const load = () => { calls++; return pending.promise; };
  const first = loader.run({ after: "one", load, signal: owner.signal });
  assert.equal(loader.run({ after: "one", load, signal: joiner.signal }), first);
  joiner.abort();
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ syncCursor: "two" });
  assert.deepEqual(await first, { syncCursor: "two" });
});

test("manual intent joining equivalent running work exposes its failure once", async () => {
  const states = [], loader = createIOSThreadLoad(s => states.push(s));
  await loader.run({ load: async () => ({ syncCursor: null }) });
  const pending = deferred();
  const first = loader.run({ load: () => pending.promise });
  await Promise.resolve();
  assert.equal(loader.run({ interactive: true, load: () => assert.fail("joined read must not load twice") }), first);
  pending.reject(new Error("offline"));
  await assert.rejects(first);
  assert.deepEqual(states, ["ready", "error"]);
});

test("forced context does not join an ordinary full read and a failed predecessor does not block it", async () => {
  const loader = createIOSThreadLoad(() => {}), pending = deferred(), calls = [];
  const first = loader.run({ load: () => pending.promise });
  const forced = loader.run({ forceContext: true, load: options => { calls.push(options); return { relationshipContext: {} }; } });
  assert.notEqual(first, forced);
  const failure = assert.rejects(first);
  pending.reject(new Error("offline"));
  await failure;
  await forced;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].forceContext, true);
});

test("aborting queued work prevents its load without cancelling the request ahead of it", async () => {
  const loader = createIOSThreadLoad(() => {}), pending = deferred(), controller = new AbortController();
  let firstSignal;
  const first = loader.run({ load: ({ signal }) => { firstSignal = signal; return pending.promise; } });
  const queued = loader.run({ signal: controller.signal, forceContext: true, load: () => assert.fail("aborted queued request ran") });
  const failure = assert.rejects(queued, { name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  assert.equal(firstSignal.aborted, false);
  pending.resolve({ syncCursor: "current" });
  await first;
  await failure;
});

test("cancel fences ignored abort results and queued work; a new generation can run immediately", async () => {
  const states = [];
  const loader = createIOSThreadLoad(s => states.push(s));
  const pending = deferred();
  let oldSignal, queuedCalls = 0;
  const old = loader.run({ load: ({ signal }) => { oldSignal = signal; return pending.promise; } });
  const queued = loader.run({ forceContext: true, load: () => { queuedCalls++; return {}; } });
  const settled = Promise.allSettled([old, queued]);
  await Promise.resolve();
  loader.cancel();
  assert.equal(oldSignal.aborted, true);
  await loader.run({ load: async () => ({ syncCursor: null }) });
  pending.resolve({ syncCursor: "old" });
  assert.ok((await settled).every(result => result.status === "rejected" && result.reason.name === "AbortError"));
  assert.equal(queuedCalls, 0);
  assert.deepEqual(states, ["ready"]);
});

test("stale Store results do not establish readiness, and aborted interactive reads restore status", async () => {
  const states = [];
  const loader = createIOSThreadLoad(s => states.push(s));
  await assert.rejects(loader.run({ load: async () => ({ stale: true }) }), { name: "AbortError" });
  assert.ok(!states.includes("ready"));
  await assert.rejects(loader.run({ load: offline }));
  const pending = deferred(), controller = new AbortController();
  const retry = loader.run({ interactive: true, signal: controller.signal, load: () => pending.promise });
  await Promise.resolve();
  controller.abort();
  pending.resolve({});
  await assert.rejects(retry, { name: "AbortError" });
  assert.deepEqual(states.slice(-3), ["error", "loading", "error"]);
});

test("Thread integration keeps polling, drafts, read markers, scroll and legacy transport intact", () => {
  const source = readFileSync(new URL("../screens/ThreadScreen.jsx", import.meta.url), "utf8");
  assert.equal((source.match(/useLiveChat\(/g) || []).length, 1);
  assert.match(source, /: loadRelationshipThread\(\{ after, signal \}\)/);
  assert.match(source, /: loadRelationshipThread\(\{ signal, strict: true, forceContext: true \}\)/);
  assert.match(source, /const relationshipScope = isIOS \? threadRefreshScope : composerScope/);
  assert.match(source, /!signal\?\.aborted && !result\?\.stale/);
  assert.match(source, /session && threadStatus === "ready"/);
  assert.match(source, /refreshFlight.current\?\.owner === relationshipOwner/);
  assert.match(source, /announceForAccessibilityWithOptions\(THREAD_READ_ERROR, \{ queue: true \}\)/);
  assert.match(source, /const claim = iosDraft.claim\(\)/);
  assert.match(source, /if \(otherId && incomingReadTarget\) void markThreadRead\(otherId\)/);
  assert.match(source, /useChatScroll\(\{ messageCount: messages.length, scopeKey: `\$\{chatAuthEpoch\}:\$\{composerScope\}` \}\)/);
});

const screenSource = readFileSync(new URL("../screens/ThreadScreen.jsx", import.meta.url), "utf8");
const ast = parse(screenSource, { sourceType: "module", plugins: ["jsx"] });
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of Object.values(node)) {
    for (const value of Array.isArray(child) ? child : [child]) {
      const result = find(value, predicate);
      if (result) return result;
    }
  }
  return null;
}
function compile(node, bindings) {
  return new Function(...Object.keys(bindings), `return (${screenSource.slice(node.start, node.end)});`)(...Object.values(bindings));
}
const named = name => find(ast, node => node.type === "VariableDeclarator" && node.id?.name === name).init;

test("actual refresh callback shares repeat taps and releases only its own flight", async () => {
  const pending = deferred(), refreshFlight = { current: null }, owner = {};
  let calls = 0;
  const render = relationshipOwner => compile(named("refreshThread"), {
    isIOS: true, relationshipOwner, refreshFlight,
    runThreadRefresh: () => { calls++; return pending.promise; },
  });
  const refresh = render(owner), first = refresh();
  assert.equal(refresh(), first);
  assert.equal(calls, 1);
  const newer = render({})();
  assert.equal(calls, 2);
  pending.resolve({ ok: false });
  await Promise.all([first, newer]);
  assert.equal(refreshFlight.current, null);
});

test("actual relationship loader rejects old account/epoch/recipient and unmounted context updates", async () => {
  for (const change of ["owner", "unmount", "abort", "stale"]) {
    const pending = deferred(), relationshipOwner = { alive: true, loaded: false };
    const activeOwner = { current: relationshipOwner }, controller = new AbortController(), updates = [];
    const load = compile(named("loadRelationshipThread"), {
      isIOS: true,
      relationshipScope: "account:epoch:recipient", relationshipOwner, activeOwner, otherId: "recipient",
      loadThread: () => pending.promise,
      normalizeMessageRelationshipContext: value => value,
      setRelationshipState: value => updates.push(value),
    });
    const result = load({ signal: controller.signal });
    if (change === "owner") activeOwner.current = { alive: true };
    if (change === "unmount") relationshipOwner.alive = false;
    if (change === "abort") controller.abort();
    pending.resolve({ relationshipContext: { summary: "old" }, stale: change === "stale" });
    await result;
    assert.equal(updates.length, 0, change);
    assert.equal(relationshipOwner.loaded, false, change);
  }
});

test("actual non-iOS relationship path preserves legacy context and scope behavior", async () => {
  const relationshipScopeRef = { current: "legacy" }, relationshipLoadedRef = { current: false }, updates = [], calls = [];
  let pending;
  const load = compile(named("loadRelationshipThread"), {
    isIOS: false, relationshipScopeRef, relationshipLoadedRef, otherId: "recipient",
    loadThread: (id, options) => { calls.push({ id, options }); return pending.promise; },
    normalizeMessageRelationshipContext: value => value,
    setRelationshipState: value => updates.push(value),
  });
  pending = deferred();
  const controller = new AbortController();
  const first = load({ after: "cursor", signal: controller.signal });
  // Legacy updates use only scope equality, including stale/abort returns.
  controller.abort();
  pending.resolve({ relationshipContext: { summary: "legacy" }, stale: true });
  await first;
  assert.equal(calls[0].options.strict, false);
  assert.equal(calls[0].options.includeContext, true);
  assert.equal(calls[0].options.after, "cursor");
  assert.equal(updates.length, 1);
  assert.equal(relationshipLoadedRef.current, true);
  pending = deferred();
  const second = load();
  assert.equal(calls[1].options.includeContext, false);
  relationshipScopeRef.current = "other";
  pending.resolve({ relationshipContext: {} });
  await second;
  assert.equal(updates.length, 1);
});

test("actual manual failure callback queues speech only for active owner and enabled VoiceOver", () => {
  const onError = find(ast, node => node.type === "ObjectProperty" && node.key?.name === "onError").value.consequent;
  for (const mode of ["current", "old", "unmounted", "reader-off", "old-error"]) {
    const relationshipOwner = { alive: mode !== "unmounted" }, updates = [], speech = [];
    const callback = compile(onError, {
      relationshipOwner, activeOwner: { current: mode === "old" ? {} : relationshipOwner },
      setThreadLoad: value => updates.push(value), screenReaderEnabled: mode !== "reader-off",
      THREAD_READ_ERROR: "Messages could not update.",
      announceThreadFailure: () => speech.push(true),
    });
    callback({ threadOwner: mode === "old-error" ? {} : relationshipOwner });
    assert.equal(updates.length, ["current", "reader-off"].includes(mode) ? 1 : 0);
    assert.equal(speech.length, mode === "current" ? 1 : 0);
    // The lifecycle hook owns delayed native speech, tested separately.
  }
});
