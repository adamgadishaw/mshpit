import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationActivityBootstrap } from "./notificationActivityBootstrap.mjs";
import { createNotificationActivity, NOTIFICATION_READ_CONTRACT } from "./notificationActivityState.mjs";
import * as pageCommand from "./notificationPageLoad.mjs";
import * as readCommand from "./notificationReadCommand.mjs";

const tick = () => new Promise(setImmediate);
const error = message => Object.assign(new Error(message), { name: "AppError", code: "PIT-NET-001", retryable: true });
const row = (id, userId = "A", extra = {}) => ({ id, userId, ts: 1, read: false, type: "welcome", ...extra });
const page = (rows = [], extra = {}) => ({ notifications: rows, unread: rows.filter(r => !r.read).length,
  nextCursor: null, readContract: NOTIFICATION_READ_CONTRACT, ...extra });
function fixture() {
  let identity = { accountId: "A", epoch: 1, ready: true };
  const imports = [], reads = [], writes = [];
  const capture = list => args => new Promise((resolve, reject) => list.push({ args, resolve, reject }));
  // Only transport/module delivery are mocked. The facade adopts the real core
  // controller, whose queue, projection and acknowledgement logic remain intact.
  const runtime = { createNotificationRuntime: options => createNotificationActivity({ ...options,
    fetchPage: capture(reads), writeReads: capture(writes),
    loadPageCommand: async () => pageCommand, loadReadCommand: async () => readCommand,
  }) };
  const controller = createNotificationActivityBootstrap({ getIdentity: () => identity,
    makeError: error, normalizeError: cause => cause.name === "AppError" ? cause : error(cause.message),
    loadRuntime: () => new Promise((resolve, reject) => imports.push({ resolve, reject })),
  });
  return { controller, imports, reads, writes, runtime,
    get snapshot() { return controller.getSnapshot(); },
    adopt(accountId, epoch = identity.epoch + 1, ready = true) {
      identity = { accountId, epoch, ready }; return controller.getSnapshot();
    },
    async hydrate(rows = []) {
      const pending = controller.load(); await tick();
      imports.at(-1).resolve(runtime); await tick(); reads.at(-1).resolve(page(rows)); await pending;
    },
  };
}

test("cold duplicate heads share one runtime import and one core GET", async () => {
  const f = fixture(), first = f.controller.load(), second = f.controller.load();
  assert.equal(f.imports.length, 1); assert.equal(f.snapshot.status, "loading");
  assert.equal(f.reads.length, 0);
  f.imports[0].resolve(f.runtime); await tick(); assert.equal(f.reads.length, 1);
  f.reads[0].resolve(page([row("remote", "A", { type: "like" })]));
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(rows => rows.map(r => r.id)), [["remote"], ["remote"]]);
  assert.equal(f.snapshot.status, "ready"); assert.equal(f.writes.length, 0);
});

for (const boundary of ["B", "A-B-A", "epoch", "guest"]) {
  test(`cold ${boundary} transition resets synchronously and never starts stale transport`, async () => {
    const f = fixture(), oldScope = f.controller.scope();
    f.controller.setRows([row("old-welcome")]);
    const pending = f.controller.load(); const rejected = assert.rejects(pending, { name: "AbortError" });
    if (boundary === "A-B-A") { f.adopt("B"); f.adopt("A"); }
    else if (boundary === "epoch") f.adopt("A", 2);
    else f.adopt(boundary === "guest" ? null : "B");
    assert.deepEqual(f.snapshot.data.rows, []); assert.equal(f.snapshot.data.unread, null);
    let staleUpdaterCalled = false;
    f.controller.setRows(() => { staleUpdaterCalled = true; return [row("leak")]; }, oldScope);
    assert.equal(staleUpdaterCalled, false);
    f.imports[0].resolve(f.runtime); await rejected; await tick();
    assert.equal(f.reads.length, 0); assert.deepEqual(f.snapshot.data.rows, []);
    if (boundary === "guest") {
      await assert.rejects(f.controller.load(), { name: "AbortError" });
      assert.equal(f.reads.length, 0);
    } else {
      const fresh = f.controller.load(); await tick();
      assert.equal(f.reads.length, 1); assert.equal(f.reads[0].args.accountId, boundary === "B" ? "B" : "A");
      f.reads[0].resolve(page()); await fresh;
    }
  });
}

test("same-account cold unmount/remount retires old observer but allows new hydration", async () => {
  const f = fixture(); f.controller.setRows([row("welcome")]);
  const old = f.controller.load(); const rejected = assert.rejects(old, { name: "AbortError" });
  f.controller.unmount(); f.controller.mount();
  const fresh = f.controller.load(); assert.equal(f.imports.length, 1);
  f.imports[0].resolve(f.runtime); await rejected; await tick();
  assert.equal(f.reads.length, 1); f.reads[0].resolve(page()); await fresh;
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["welcome"]);
});

test("runtime resolving while unmounted cannot fetch until a later mount", async () => {
  const f = fixture(), old = f.controller.load(); const rejected = assert.rejects(old, { name: "AbortError" });
  f.controller.unmount(); f.imports[0].resolve(f.runtime); await rejected; await tick();
  assert.equal(f.reads.length, 0);
  f.controller.mount(); const fresh = f.controller.load(); await tick();
  assert.equal(f.reads.length, 1); f.reads[0].resolve(page()); await fresh;
});

test("cancelling one cold observer leaves another shared runtime read usable", async () => {
  const f = fixture(), caller = new AbortController();
  const first = f.controller.load({ signal: caller.signal }), second = f.controller.load();
  const rejected = assert.rejects(first, { name: "AbortError" }); caller.abort(); await rejected;
  assert.equal(f.imports.length, 1); f.imports[0].resolve(f.runtime); await tick();
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].args.signal.aborted, false);
  f.reads[0].resolve(page()); await second; assert.equal(f.snapshot.status, "ready");
});

test("runtime import failure retains welcome in retryable LoadState and retry succeeds", async () => {
  const f = fixture(); f.controller.setRows([row("welcome")]);
  const first = f.controller.load(); const rejected = assert.rejects(first, e => e.retryable === true);
  f.imports[0].reject(new Error("Chunk unavailable")); await rejected;
  assert.equal(f.snapshot.status, "error"); assert.equal(f.snapshot.error.retryable, true);
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["welcome"]); assert.equal(f.reads.length, 0);
  const retry = f.controller.load(); assert.equal(f.imports.length, 2);
  f.imports[1].resolve(f.runtime); await tick(); f.reads[0].resolve(page()); await retry;
  assert.equal(f.snapshot.status, "ready"); assert.equal(f.snapshot.error, null);
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["welcome"]); assert.equal(f.snapshot.data.unread, 1);
});

test("pre-load setRows filters account ownership, stays bounded and transfers welcome to core", async () => {
  const f = fixture();
  f.controller.setRows([row("foreign", "B"), ...Array.from({ length: 1005 }, (_, i) => row(`welcome${i}`))]);
  assert.equal(f.snapshot.data.rows.length, 1000);
  assert.ok(f.snapshot.data.rows.every(r => r.userId === "A"));
  assert.equal(f.imports.length, 0); assert.equal(f.reads.length, 0);
  await f.hydrate();
  assert.equal(f.snapshot.data.rows.length, 1000); assert.equal(f.snapshot.data.unread, 1000);
  assert.ok(f.snapshot.data.rows.every(r => r.type === "welcome"));
});

test("retained setRows scope cannot mutate a different runtime account or invoke its updater", async () => {
  const f = fixture(), oldScope = f.controller.scope(); await f.hydrate(); f.adopt("B");
  let invoked = false;
  f.controller.setRows(() => { invoked = true; return [row("secret")]; }, oldScope);
  assert.equal(invoked, false); assert.deepEqual(f.snapshot.data.rows, []);
});

test("markRead before capability never loads code or writes, including during cold hydration", async () => {
  const f = fixture(); f.controller.setRows([row("welcome")]);
  assert.equal((await f.controller.markRead({ notificationIds: ["welcome"] })).ok, false);
  assert.equal(f.imports.length, 0); assert.equal(f.writes.length, 0);
  const pending = f.controller.load();
  assert.equal((await f.controller.markRead({ notificationIds: ["welcome"] })).ok, false);
  f.imports[0].resolve(f.runtime); await tick();
  const beforeCapability = f.controller.markRead({ notificationIds: ["welcome"] });
  assert.equal(f.writes.length, 0);
  f.reads[0].resolve(page([], { readContract: undefined })); await pending;
  assert.equal((await beforeCapability).ok, false);
  assert.equal((await f.controller.markRead({ notificationIds: ["welcome"] })).ok, false);
  assert.equal(f.writes.length, 0); assert.equal(f.snapshot.data.rows[0].read, false);
});


test("a second cold load preserves welcome added while the first import waits", async () => {
  const f = fixture(), first = f.controller.load();
  f.controller.setRows([row("late-welcome")]);
  const second = f.controller.load();
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["late-welcome"]);
  assert.equal(f.imports.length, 1);
  f.imports[0].resolve(f.runtime); await tick(); assert.equal(f.reads.length, 1);
  f.reads[0].resolve(page()); await Promise.all([first, second]);
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["late-welcome"]);
  assert.equal(f.snapshot.data.unread, 1);
});
