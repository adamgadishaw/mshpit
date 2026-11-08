import * as notificationReadCommand from "./notificationReadCommand.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationActivity, NOTIFICATION_READ_CONTRACT } from "./notificationActivityState.mjs";
const tick = () => new Promise(setImmediate);
const error = (message = "offline", code = "PIT-NET-001") => Object.assign(new Error(message), { name: "AppError", code, retryable: true });
const row = (id, extra = {}) => ({ id, ts: 100, read: false, type: "like", ...extra });
const page = (rows, extra = {}) => ({ notifications: rows, unread: rows.filter(r => !r.read).length, nextCursor: null, readContract: NOTIFICATION_READ_CONTRACT, ...extra });
function fixture(options = {}) {
  let identity = { accountId: "A", epoch: 1, ready: true };
  const reads = [], writes = [];
  const capture = list => args => new Promise((resolve, reject) => list.push({ args, resolve, reject }));
  const controller = createNotificationActivity({ getIdentity: () => identity, fetchPage: capture(reads), writeReads: capture(writes), makeError: error, normalizeError: e => e.name === "AppError" ? e : error(e.message), ...options });
  return { controller, reads, writes, get snapshot() { return controller.getSnapshot(); },
    adopt(accountId, epoch = identity.epoch + 1, ready = true) { identity = { accountId, epoch, ready }; return controller.getSnapshot(); },
    async load(rows = [row("one")], extra = {}) { const p = controller.load(); await tick(); reads.at(-1).resolve(page(rows, extra)); await p; },
  };
}

test("hydrates without writes, keeps authoritative unread and deduplicates reads", async () => {
  const f = fixture(), first = f.controller.load(), second = f.controller.load();
  await tick(); assert.equal(f.reads.length, 1); assert.equal(f.snapshot.status, "loading");
  f.reads[0].resolve(page([row("one")], { unread: 205, nextCursor: "older" }));
  await Promise.all([first, second]);
  assert.equal(f.snapshot.data.unread, 205); assert.equal(f.snapshot.data.nextCursor, "older");
  assert.equal(f.snapshot.data.rows[0].userId, "A"); assert.equal(f.writes.length, 0);
});

test("pagination appends/deduplicates; deliberate refresh resets history", async () => {
  const f = fixture(); await f.load([row("new", { ts: 200 })], { nextCursor: "older", unread: 3 });
  const more = f.controller.load({ more: true }); await tick();
  assert.equal(f.reads.at(-1).args.cursor, "older");
  f.reads.at(-1).resolve(page([row("new", { ts: 200 }), row("old")], { unread: 3 })); await more;
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["new", "old"]);
  await f.load([row("fresh")]); assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["fresh"]);
});

test("visible page errors retain rows/cursor; initial failures are not empty success", async () => {
  const f = fixture(), initial = f.controller.load(); await tick(); f.reads[0].reject(error());
  await assert.rejects(initial); assert.equal(f.snapshot.status, "error"); assert.equal(f.snapshot.updatedAt, null);
  await f.load([row("one")], { nextCursor: "older" });
  const more = f.controller.load({ more: true }); await tick(); f.reads.at(-1).reject(error());
  await assert.rejects(more); assert.equal(f.snapshot.status, "error");
  assert.equal(f.snapshot.data.rows[0].id, "one"); assert.equal(f.snapshot.data.nextCursor, "older");
});

test("badge summary refresh updates total without collapsing loaded pages", async () => {
  const f = fixture(); await f.load([row("one"), row("two")], { unread: 20, nextCursor: "older" });
  const summary = f.controller.load({ summary: true }); await tick();
  assert.equal(f.reads.at(-1).args.limit, 1);
  f.reads.at(-1).resolve(page([row("new")], { unread: 21 })); await summary;
  assert.equal(f.snapshot.data.unread, 21); assert.deepEqual(f.snapshot.data.rows.map(r => r.id).sort(), ["one", "two"]);
  assert.equal(f.snapshot.data.nextCursor, "older"); assert.equal(f.writes.length, 0);
});

test("explicit ack sends only captured loaded IDs and adopts server-confirmed IDs/count", async () => {
  const f = fixture(); await f.load([row("one"), row("two")], { unread: 4 });
  const read = f.controller.markRead({ notificationIds: ["one", "one", "unseen"] }); await tick();
  assert.deepEqual(f.writes[0].args.notificationIds, ["one"]); assert.equal(f.writes[0].args.accountId, "A");
  assert.equal(f.snapshot.data.rows.find(r => r.id === "one").read, false);
  f.writes[0].resolve({ ok: true, readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["one"], unread: 4 });
  const result = await read; assert.equal(result.ok, true); assert.deepEqual(result.value.notificationIds, ["one"]);
  assert.equal(f.snapshot.data.rows.find(r => r.id === "one").read, true);
  assert.equal(f.snapshot.data.rows.find(r => r.id === "two").read, false); assert.equal(f.snapshot.data.unread, 4);
});

test("unconfirmed IDs and malformed ack responses never get marked locally", async () => {
  for (const response of [{ ok: true }, { ok: true, readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["not-requested"], unread: 0 }]) {
    const f = fixture(); await f.load(); const p = f.controller.markRead({ notificationIds: ["one"] }); await tick();
    f.writes[0].resolve(response); assert.equal((await p).ok, false); assert.equal(f.snapshot.data.rows[0].read, false);
  }
  const f = fixture(); await f.load(); const p = f.controller.markRead({ notificationIds: ["one"] }); await tick();
  f.writes[0].resolve({ ok: true, readContract: NOTIFICATION_READ_CONTRACT, notificationIds: [], unread: 0 });
  assert.equal((await p).ok, true); assert.equal(f.snapshot.data.rows[0].read, false);
});

test("old server is read-only compatible and never receives an unsafe ack", async () => {
  const f = fixture(); await f.load([row("one")], { readContract: undefined });
  assert.equal((await f.controller.markRead({ notificationIds: ["one"] })).ok, false);
  assert.equal(f.writes.length, 0); assert.equal(f.snapshot.data.rows[0].read, false);
});

for (const boundary of ["B", null, "roundtrip", "unready"]) {
  test(`pending read, writes and retained controls cannot cross ${boundary}`, async () => {
    const f = fixture(); await f.load(); const oldScope = f.controller.scope();
    const p = f.controller.markRead({ notificationIds: ["one"], expectedScope: oldScope }); await tick();
    if (boundary === "roundtrip") { f.adopt("B"); f.adopt("A"); }
    else if (boundary === "unready") f.adopt("A", 1, false);
    else f.adopt(boundary);
    assert.equal(f.writes[0].args.signal.aborted, true); assert.equal(f.snapshot.data.rows.length, 0);
    f.writes[0].resolve({ ok: true, readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["one"], unread: 0 });
    await assert.rejects(p, { name: "AbortError" });
    assert.equal(f.snapshot.data.rows.length, 0);
    const stale = await f.controller.markRead({ notificationIds: ["one"], expectedScope: oldScope });
    assert.equal(stale.ok, false); assert.equal(f.writes.length, 1);
    f.controller.setRows([row("secret", { userId: "A" })], oldScope); assert.equal(f.snapshot.data.rows.length, 0);
  });
}

test("a late old read cannot restore data even after A-B-A", async () => {
  const f = fixture(), pending = f.controller.load(); await tick(); f.adopt("B"); f.adopt("A");
  f.reads[0].resolve(page([row("old-secret")])); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.snapshot.data.rows.length, 0);
});

test("read/ack/read serialization prevents a pre-write GET overwriting confirmation", async () => {
  const f = fixture(); await f.load();
  const refresh = f.controller.load(); const ack = f.controller.markRead({ notificationIds: ["one"] });
  await tick(); assert.equal(f.writes.length, 0); f.reads.at(-1).resolve(page([row("one")])); await refresh; await tick();
  assert.equal(f.writes.length, 1);
  const summary = f.controller.load({ summary: true }); await tick(); assert.equal(f.reads.length, 2);
  f.writes[0].resolve({ ok: true, readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["one"], unread: 0 }); await ack; await tick();
  f.reads.at(-1).resolve(page([row("one", { read: true })], { unread: 0 })); await summary;
  assert.equal(f.snapshot.data.rows[0].read, true); assert.equal(f.snapshot.data.unread, 0);
});

test("one cancelled read observer does not cancel another screen's shared hydration", async () => {
  const f = fixture(), c = new AbortController(); const one = f.controller.load({ signal: c.signal }), two = f.controller.load();
  c.abort(); await assert.rejects(one, { name: "AbortError" }); await tick();
  assert.equal(f.reads[0].args.signal.aborted, false); f.reads[0].resolve(page([row("one")])); await two;
  assert.equal(f.snapshot.status, "ready");
});

test("unmount cancels requests and blocks retained controls; remount remains usable", async () => {
  const f = fixture(); const p = f.controller.load(); await tick(); f.controller.unmount();
  assert.equal(f.reads[0].args.signal.aborted, true); f.reads[0].resolve(page([row("one")])); await assert.rejects(p, { name: "AbortError" });
  assert.equal((await f.controller.markRead({ notificationIds: ["one"] })).ok, false);
  f.controller.mount(); await f.load(); assert.equal(f.snapshot.status, "ready");
});

test("acks batch 100 IDs and retain partial confirmations when later batch fails", async () => {
  const f = fixture(), rows = Array.from({ length: 101 }, (_, i) => row(`n${i}`, { ts: 1000 - i })); await f.load(rows);
  const p = f.controller.markRead({ notificationIds: rows.map(r => r.id) }); await tick(); assert.equal(f.writes[0].args.notificationIds.length, 100);
  f.writes[0].resolve({ ok: true, readContract: NOTIFICATION_READ_CONTRACT, notificationIds: f.writes[0].args.notificationIds, unread: 1 }); await tick();
  assert.equal(f.writes[1].args.notificationIds.length, 1); f.writes[1].reject(error()); assert.equal((await p).ok, false);
  assert.equal(f.snapshot.data.rows.filter(r => r.read).length, 100); assert.equal(f.snapshot.data.unread, 1);
});

test("history cache is bounded with an explicit limited flag", async () => {
  const f = fixture();
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const rows = Array.from({ length: 100 }, (_, i) => row(`n${pageNumber * 100 + i}`, { ts: 2000 - pageNumber * 100 - i }));
    const p = f.controller.load({ more: pageNumber > 0 }); await tick();
    f.reads.at(-1).resolve(page(rows, { unread: 1200, nextCursor: `cursor${pageNumber}` })); await p;
  }
  assert.equal(f.snapshot.data.rows.length, 1000); assert.equal(f.snapshot.data.historyLimited, true);
  assert.equal(f.snapshot.data.nextCursor, null); assert.equal(f.snapshot.data.unread, 1200);
});

test("retired remount GET cannot erase a newer successful snapshot", async () => {
  const f = fixture(); const old = f.controller.load(); await tick();
  f.controller.unmount(); f.controller.mount();
  const fresh = f.controller.load(); await tick();
  f.reads[1].resolve(page([row("new")])); await fresh;
  f.reads[0].resolve(page([row("old")])); await assert.rejects(old, { name: "AbortError" });
  assert.equal(f.snapshot.status, "ready"); assert.equal(f.snapshot.data.rows[0].id, "new");
});

for (const change of ["read", "privacy"]) {
  test(`an older GET cannot undo an externally confirmed ${change} mutation`, async () => {
    const f = fixture(); await f.load([row("dm")]);
    const pending = f.controller.load(); await tick();
    f.controller.setRows(rows => change === "read" ? rows.map(r => ({ ...r, read: true })) : []);
    f.reads[1].resolve(page([row("dm")], { unread: 1 })); await tick();
    assert.equal(f.reads.length, 3, "stale pre-mutation response triggers a bounded fresh read");
    assert.equal(f.snapshot.data.rows.filter(r => !r.read).length, 0);
    f.reads[2].resolve(page(change === "read" ? [row("dm", { read: true })] : [], { unread: 0 })); await pending;
    assert.equal(f.snapshot.data.unread, 0); assert.equal(f.snapshot.data.rows.filter(r => !r.read).length, 0);
  });
}

test("failed post-mutation reload retains the privacy scrub, not the old snapshot", async () => {
  const f = fixture(); await f.load([row("secret")]); const pending = f.controller.load(); await tick();
  f.controller.setRows([]); f.reads[1].resolve(page([row("secret")])); await tick(); f.reads[2].reject(error());
  await assert.rejects(pending); assert.equal(f.snapshot.status, "error"); assert.equal(f.snapshot.data.rows.length, 0);
});

test("local cache eviction never decrements an authoritative unread total", async () => {
  const f = fixture(); await f.load(Array.from({ length: 1000 }, (_, i) => row(`n${i}`, { ts: i })), { unread: 1200 });
  f.controller.setRows(rows => [row("welcome", { type: "welcome", userId: "A", ts: 2000 }), ...rows]);
  assert.equal(f.snapshot.data.rows.length, 1000); assert.equal(f.snapshot.data.unread, 1201);
});

test("demo read status survives reload without calling remote transport", async () => {
  const f = fixture({ demo: true, seed: [row("demo", { userId: "A" })] });
  await f.controller.load(); assert.equal(f.reads.length, 0);
  assert.equal((await f.controller.markRead({ notificationIds: ["demo"] })).ok, true);
  await f.controller.load(); assert.equal(f.snapshot.data.rows[0].read, true); assert.equal(f.snapshot.data.unread, 0); assert.equal(f.writes.length, 0);
});

test("pending local mute filters all fetched rows until server confirmation", async () => {
  const hidden = new Set(); const f = fixture({ getHiddenActorIds: () => [...hidden] });
  await f.load([row("muted", { actorId: "actor" }), row("safe", { actorId: "other" })]);
  hidden.add("actor"); f.controller.setRows(rows => rows.filter(r => r.actorId !== "actor"));
  const refresh = f.controller.load(); await tick();
  f.reads.at(-1).resolve(page([row("muted", { actorId: "actor" }), row("safe", { actorId: "other" })])); await refresh;
  assert.deepEqual(f.snapshot.data.rows.map(r => r.id), ["safe"]);
});

test("a superseded same-frame mark cannot cancel the newer exact-ID intent", async () => {
  const f = fixture(); await f.load();
  const firstSignal = new AbortController();
  const first = f.controller.markRead({ notificationIds: ["one"], signal: firstSignal.signal });
  firstSignal.abort();
  const second = f.controller.markRead({ notificationIds: ["one"] });
  await assert.rejects(first, { name: "AbortError" }); await tick();
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].args.notificationIds, ["one"]);
  f.writes[0].resolve({ readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["one"], unread: 0 });
  assert.equal((await second).ok, true); assert.equal(f.snapshot.data.rows[0].read, true);
});

// Delay only the dynamic module boundary, then execute the actual command.
// This models a cold web chunk without network access or timing assumptions.
function delayedReadCommand() {
  const imports = [];
  return { imports, loadReadCommand: () => new Promise((resolve, reject) => imports.push({ resolve, reject })) };
}

for (const boundary of ["logout", "A-B-A", "unmount", "unmount-remount", "caller cancellation"]) {
  test(`a cold acknowledgement chunk cannot write after ${boundary}`, async () => {
    const loader = delayedReadCommand(), f = fixture({ loadReadCommand: loader.loadReadCommand });
    await f.load();
    const caller = new AbortController();
    const pending = f.controller.markRead({ notificationIds: ["one"], signal: caller.signal });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await tick(); assert.equal(loader.imports.length, 1); assert.equal(f.writes.length, 0);
    if (boundary === "logout") f.adopt(null);
    else if (boundary === "A-B-A") { f.adopt("B"); f.adopt("A"); }
    else if (boundary === "unmount") f.controller.unmount();
    else if (boundary === "unmount-remount") { f.controller.unmount(); f.controller.mount(); }
    else caller.abort();
    loader.imports[0].resolve(notificationReadCommand);
    await rejected; await tick();
    assert.equal(f.writes.length, 0, "resolving code must not revive retired write authority");
    assert.ok(f.snapshot.data.rows.every(r => !r.read));
    if (boundary === "logout" || boundary === "A-B-A") assert.deepEqual(f.snapshot.data.rows, []);
  });
}

test("cold chunk loading preserves captured IDs and read/ack/read queue order", async () => {
  const loader = delayedReadCommand(), f = fixture({ loadReadCommand: loader.loadReadCommand });
  await f.load([row("one"), row("two")], { unread: 3 });
  const refresh = f.controller.load();
  const selected = ["one", "one", "unseen"];
  const ack = f.controller.markRead({ notificationIds: selected });
  selected.splice(0, selected.length, "two", "arriving");
  await tick();
  assert.equal(f.reads.length, 2); assert.equal(loader.imports.length, 0, "import waits for preceding GET");
  f.reads[1].resolve(page([row("one"), row("two"), row("arriving")], { unread: 3 }));
  await refresh; await tick();
  assert.equal(loader.imports.length, 1); assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 0);
  const summary = f.controller.load({ summary: true });
  await tick(); assert.equal(f.reads.length, 2, "summary waits behind the cold acknowledgement");
  // Local state changes during download do not expand the deliberate selection.
  f.controller.setRows(rows => [...rows, row("local-arrival", { userId: "A", ts: 200 })]);
  loader.imports[0].resolve(notificationReadCommand); await tick();
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].args.notificationIds, ["one"]);
  assert.equal(f.writes[0].args.accountId, "A"); assert.equal(f.reads.length, 2, "later summary waits for write confirmation");
  f.writes[0].resolve({ readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["one"], unread: 2 });
  assert.equal((await ack).ok, true); await tick();
  assert.equal(f.reads.length, 3); assert.equal(f.reads[2].args.limit, 1);
  assert.equal(f.snapshot.data.rows.find(r => r.id === "one").read, true);
  assert.ok(f.snapshot.data.rows.filter(r => r.id !== "one").every(r => !r.read));
  f.reads[2].resolve(page([row("arriving")], { unread: 2 })); await summary;
  assert.equal(f.snapshot.data.rows.find(r => r.id === "one").read, true);
  assert.equal(f.snapshot.data.unread, 2);
});

test("a failed cold import is recoverable and does not poison queued GET or acknowledgement retry", async () => {
  const loader = delayedReadCommand(), f = fixture({ loadReadCommand: loader.loadReadCommand });
  await f.load();
  const ack = f.controller.markRead({ notificationIds: ["one"] });
  const refresh = f.controller.load();
  await tick(); assert.equal(loader.imports.length, 1); assert.equal(f.reads.length, 1);
  loader.imports[0].reject(new Error("Chunk download failed"));
  const result = await ack;
  assert.equal(result.ok, false); assert.equal(result.error.retryable, true);
  assert.equal(f.writes.length, 0); assert.equal(f.snapshot.data.rows[0].read, false);
  await tick(); assert.equal(f.reads.length, 2, "failed import releases the queue for GET");
  f.reads[1].resolve(page([row("one")])); await refresh;
  const retry = f.controller.markRead({ notificationIds: ["one"] }); await tick();
  assert.equal(loader.imports.length, 2, "retry does not retain a rejected import promise");
  loader.imports[1].resolve(notificationReadCommand); await tick();
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].args.notificationIds, ["one"]);
  f.writes[0].resolve({ readContract: NOTIFICATION_READ_CONTRACT, notificationIds: ["one"], unread: 0 });
  assert.equal((await retry).ok, true); assert.equal(f.snapshot.data.rows[0].read, true);
});
