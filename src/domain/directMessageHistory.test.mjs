import assert from "node:assert/strict";
import test from "node:test";
import { createDirectMessageHistory, createDirectMessageHistoryAnchor } from "./directMessageHistory.mjs";

const rows = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => {
  const at = start + index;
  return { id: `m${String(at).padStart(4, "0")}`, at, from: "peer", text: `Message ${at}`, server: true };
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("1250 loaded messages survive the recent750 window and later incoming and confirmed outgoing rows", async () => {
  const history = createDirectMessageHistory();
  history.receive({ messages: rows(751, 1250), nextCursor: "older750" });
  await history.loadEarlier({ load: async () => ({ messages: rows(251, 750), nextCursor: "older250" }) });
  await history.loadEarlier({ load: async () => ({ messages: rows(1, 250), nextCursor: null }) });
  history.receive({ messages: rows(1251, 1252), nextCursor: null }, { after: "live1250" });
  const sent = { ...rows(1253, 1253)[0], from: "me" };
  history.remember([sent]);
  const display = history.display(rows(504, 1252));
  assert.equal(display.length, 1253);
  assert.equal(display[0].id, "m0001");
  assert.equal(display.at(-1).id, sent.id);
  assert.equal(history.read().nextCursor, null);
});

test("refresh and live updates do not rewind a progressed older cursor", async () => {
  const history = createDirectMessageHistory();
  history.receive({ messages: rows(1001, 1500), nextCursor: "older1000" });
  await history.loadEarlier({ load: async () => ({ messages: rows(501, 1000), nextCursor: "older500" }) });
  history.receive({ messages: rows(1002, 1501), nextCursor: "older1001" });
  history.receive({ messages: rows(1502, 1502), nextCursor: null }, { after: "head" });
  assert.equal(history.read().nextCursor, "older500");
  assert.equal(history.display([]).length, 1002);
});

test("a tombstone received during paging prevents late rows or live cache from resurrecting a message", async () => {
  const history = createDirectMessageHistory(), pending = deferred();
  history.receive({ messages: rows(5, 9), nextCursor: "before5" });
  const loading = history.loadEarlier({ load: () => pending.promise });
  await Promise.resolve();
  history.receive({ messages: [], removedIds: ["m0003", "m0006"] }, { after: "head" });
  pending.resolve({ messages: rows(1, 4), nextCursor: null });
  await loading;
  history.remember(rows(1, 9));
  assert.deepEqual(history.display(rows(1, 9)).map((row) => row.at), [1, 2, 4, 5, 7, 8, 9]);
});

for (const kind of ["duplicate", "page tombstones", "live tombstones"]) test(`${kind} earlier pages advance without leaving a web scroll anchor waiting for layout`, async () => {
  const history = createDirectMessageHistory(), pending = deferred();
  const anchor = createDirectMessageHistoryAnchor({ web: true });
  const initial = rows(5, 9);
  history.receive({ messages: initial, nextCursor: "before5" });
  anchor.rowLayout("m0005", { nativeEvent: { layout: { y: 100 } } });
  anchor.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
  let prepared = 0;
  const loading = history.loadEarlier({
    load: () => pending.promise,
    beforeCommit: () => { prepared++; anchor.prepare(initial.map(row => row.id)); },
  });
  await Promise.resolve();
  const removedIds = rows(1, 4).map(row => row.id);
  if (kind === "live tombstones") history.receive({ messages: [], removedIds }, { after: "head" });
  pending.resolve({
    messages: kind === "duplicate" ? rows(5, 9) : rows(1, 4),
    ...(kind === "page tombstones" ? { removedIds } : {}),
    nextCursor: "before1",
  });
  await loading;
  assert.deepEqual(history.display([]), initial);
  assert.equal(history.read().nextCursor, "before1");
  assert.equal(history.read().loading, false);
  assert.equal(history.read().error, false);
  assert.equal(prepared, 0, "unchanged rows have no new layout to resolve an anchor");
  assert.equal(anchor.contentChanged(), false);
  history.receive({ messages: rows(10, 10) }, { after: "head" });
  assert.equal(anchor.contentChanged(), false, "subsequent appends can follow normally");
});

test("earlier pages prepare before inserting rows or replacing displayed content", async () => {
  for (const incoming of [
    rows(1, 4),
    [{ ...rows(5, 5)[0], text: "A longer replacement message" }],
    [{ ...rows(5, 5)[0], ts: "An updated time label" }],
  ]) {
    const history = createDirectMessageHistory();
    const initial = rows(5, 9);
    history.receive({ messages: initial, nextCursor: "before5" });
    let prepared = 0;
    await history.loadEarlier({
      load: async () => ({ messages: incoming, nextCursor: null }),
      beforeCommit: () => {
        prepared++;
        assert.deepEqual(history.display([]), initial, "measure retained rows before publishing changed layout");
      },
    });
    assert.equal(prepared, 1);
    assert.equal(history.read().nextCursor, null);
    assert.deepEqual(history.display([]).find(row => row.id === incoming[0].id), incoming[0]);
  }
});

test("repeat taps share a request, and a failed page keeps its retry cursor and current history", async () => {
  const history = createDirectMessageHistory(), pending = deferred();
  history.receive({ messages: rows(5, 9), nextCursor: "before5" });
  let requests = 0;
  const options = { load: ({ before, strict }) => { requests++; assert.equal(before, "before5"); assert.equal(strict, true); return pending.promise; } };
  const first = history.loadEarlier(options);
  assert.equal(history.loadEarlier(options), first);
  await Promise.resolve();
  assert.equal(requests, 1);
  pending.reject(new Error("offline")); await first;
  assert.equal(history.read().error, true);
  assert.equal(history.read().loading, false);
  assert.equal(history.read().nextCursor, "before5");
  assert.equal(history.display([]).length, 5);
  await history.loadEarlier({ load: async () => ({ messages: rows(1, 4), nextCursor: null }) });
  assert.equal(history.read().error, false);
  assert.equal(history.display([]).length, 9);
});

test("a repeated cursor is a retryable failure instead of a never-ending Load earlier loop", async () => {
  const history = createDirectMessageHistory();
  history.receive({ messages: rows(5, 9), nextCursor: "before5" });
  await history.loadEarlier({ load: async () => ({ messages: rows(1, 4), nextCursor: "before5" }) });
  assert.equal(history.read().error, true);
  assert.equal(history.read().nextCursor, "before5");
  assert.equal(history.display([]).length, 5);
});

for (const status of [401, 403, 404]) test(`permission failure ${status} hides retained and recent rows until a fresh authorized head`, async () => {
  const history = createDirectMessageHistory();
  history.receive({ messages: rows(5, 9), nextCursor: "before5" });
  await history.loadEarlier({ load: async () => { throw Object.assign(new Error("unavailable"), { status }); } });
  assert.equal(history.read().unavailable, true);
  assert.deepEqual(history.display(rows(5, 9)), []);
  history.remember(rows(5, 9));
  history.receive({ messages: rows(10, 10) }, { after: "head" });
  assert.deepEqual(history.display([]), []);
  history.receive({ messages: rows(5, 10), nextCursor: "before5" });
  assert.equal(history.display([]).length, 6);
});

test("an owner replaced by block or account/thread transition cannot receive even if abort is ignored", async () => {
  let active;
  const original = createDirectMessageHistory({ isCurrent: () => active === original });
  active = original;
  original.receive({ messages: rows(5, 9), nextCursor: "before5" });
  const pending = deferred(); let signal;
  const loading = original.loadEarlier({ load: (options) => { signal = options.signal; return pending.promise; } });
  await Promise.resolve();
  active = createDirectMessageHistory();
  original.dispose();
  assert.equal(signal.aborted, true);
  pending.resolve({ messages: rows(1, 4), nextCursor: null }); await loading;
  assert.deepEqual(original.display(rows(5, 9)), []);
  assert.deepEqual(active.display([]), []);
});

test("a retired request cannot revive after the same owner is reactivated by StrictMode", async () => {
  const history = createDirectMessageHistory(), pending = deferred();
  history.receive({ messages: rows(5, 9), nextCursor: "before5" });
  const loading = history.loadEarlier({ load: () => pending.promise });
  await Promise.resolve(); history.dispose(); history.activate();
  history.receive({ messages: rows(8, 12), nextCursor: "before8" });
  pending.resolve({ messages: rows(1, 4), nextCursor: null }); await loading;
  assert.deepEqual(history.display([]).map((row) => row.at), [8, 9, 10, 11, 12]);
  assert.equal(history.read().nextCursor, "before8");
});

test("same-time rows are deduplicated by stable ID and pending sends remain owned by the outbox", () => {
  const history = createDirectMessageHistory();
  const sameTime = rows(1, 4).map((row) => ({ ...row, at: 5 }));
  history.receive({ messages: sameTime.slice(2), nextCursor: "older" });
  history.receive({ messages: sameTime.slice(0, 3), nextCursor: null }, { before: "older" });
  const pending = { id: "pending", at: 10, from: "me", text: "unsent", pending: true };
  history.remember([pending]);
  assert.equal(history.display([pending]).length, 5);
  assert.deepEqual(history.display([]).map((row) => row.id), ["m0001", "m0002", "m0003", "m0004"]);
});

test("web anchoring measures one retained row rather than counting simultaneous appends", () => {
  const calls = [], anchor = createDirectMessageHistoryAnchor({ web: true, scrollTo: (options) => calls.push(options) });
  const layout = (y) => ({ nativeEvent: { layout: { y } } });
  anchor.rowLayout("a", layout(100)); anchor.rowLayout("b", layout(150));
  anchor.onScroll({ nativeEvent: { contentOffset: { y: 125 } } });
  anchor.prepare(["a", "b"]);
  assert.equal(anchor.contentChanged(), true);
  anchor.rowLayout("newest", layout(2000));
  assert.equal(calls.length, 0);
  anchor.rowLayout("b", layout(650));
  assert.deepEqual(calls, [{ y: 625, animated: false }]);
  assert.equal(anchor.contentChanged(), false);
  assert.equal(anchor.contentChanged(), false);
});

test("web replacement with unchanged geometry suppresses once and retires its unresolved anchor", async () => {
  const history = createDirectMessageHistory(), calls = [];
  const anchor = createDirectMessageHistoryAnchor({ web: true, scrollTo: options => calls.push(options) });
  const initial = rows(5, 9);
  history.receive({ messages: initial, nextCursor: "before5" });
  anchor.rowLayout("m0005", { nativeEvent: { layout: { y: 100 } } });
  anchor.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
  await history.loadEarlier({
    load: async () => ({ messages: [{ ...initial[0], ts: "1m" }], nextCursor: null }),
    beforeCommit: () => anchor.prepare(initial.map(row => row.id)),
  });
  assert.equal(anchor.contentChanged(), true);
  assert.equal(anchor.contentChanged(), false, "a later content change must resume ordinary scroll following");
  anchor.rowLayout("m0005", { nativeEvent: { layout: { y: 1000 } } });
  assert.deepEqual(calls, [], "an obsolete layout callback must not snap back to a retired anchor");
  assert.equal(anchor.contentChanged(), false);
});

test("web anchoring also handles row layout before its one suppressed content change", () => {
  const calls = [], anchor = createDirectMessageHistoryAnchor({ web: true, scrollTo: options => calls.push(options) });
  anchor.rowLayout("a", { nativeEvent: { layout: { y: 100 } } });
  anchor.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
  anchor.prepare(["a"]);
  anchor.rowLayout("a", { nativeEvent: { layout: { y: 300 } } });
  assert.deepEqual(calls, [{ y: 300, animated: false }]);
  assert.equal(anchor.contentChanged(), true);
  assert.equal(anchor.contentChanged(), false);
});

test("native prepend suppresses a competing follow once without changing keyboard scroll policy", () => {
  const anchor = createDirectMessageHistoryAnchor();
  assert.equal(anchor.contentChanged(), false);
  anchor.prepare([]);
  assert.equal(anchor.contentChanged(), true);
  assert.equal(anchor.contentChanged(), false);
});
