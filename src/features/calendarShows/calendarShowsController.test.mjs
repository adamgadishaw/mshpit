import test from "node:test";
import assert from "node:assert/strict";
import { calendarShowsQuery } from "./calendarShowsRequest.mjs";
import { createCalendarShowsController as createController } from "./calendarShowsController.mjs";
const asError = error => Object.assign(new Error(error.message), { name: "AppError", code: "PIT-API-001", retryable: true });
const createCalendarShowsController = options => createController({ ...options, asError });

const options = { cursor: { y: 2026, m: 10 }, selected: "2026-11-20", accountId: "member-a", authEpoch: 1 };
const query = calendarShowsQuery(options);
const event = (id, extra = {}) => ({ id, date: query.date, artist: "Band", venue: "Hall", ...extra });
const page = (events = [], nextCursor = null) => ({ events, nextCursor, complete: nextCursor === null,
  monthSummary: { dayPresence: { "2026-11-20": true, "2026-11-30": true }, complete: false } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("pages beyond 500 retained rows without silent cap and completes only at cursor exhaustion", async () => {
  let calls = 0;
  const controller = createCalendarShowsController({ query, read: async (_, request) => {
    const start = calls++ * 100;
    assert.equal(request.limit, 100);
    return page(Array.from({ length: 100 }, (_, i) => event(`show-${start + i}`)), calls < 6 ? `page-${calls}` : null);
  } });
  await controller.refresh();
  assert.equal(calls, 1, "month presence must not cause an automatic full-month download");
  assert.equal(controller.getSnapshot().coverage.complete, false);
  for (let i = 0; i < 5; i += 1) await controller.loadMore();
  assert.equal(controller.getSnapshot().events.length, 600);
  assert.equal(controller.getSnapshot().coverage.complete, true);
  assert.equal(controller.getSnapshot().hasMore, false);
});

test("empty scanned page with a next cursor remains incomplete and can make progress", async () => {
  const seen = [];
  const controller = createCalendarShowsController({ query, read: async (_, { after }) => {
    seen.push(after); return after ? page([event("found")]) : page([], "scanned-forward");
  } });
  await controller.refresh();
  assert.equal(controller.getSnapshot().hasMore, true);
  assert.equal(controller.getSnapshot().coverage.complete, false);
  await controller.loadMore();
  assert.deepEqual(seen, [null, "scanned-forward"]);
  assert.equal(controller.getSnapshot().events[0].id, "found");
});

test("request failures retain only the same query's last good rows and indicate incomplete coverage", async () => {
  let fail = false;
  const controller = createCalendarShowsController({ query, read: async () => {
    if (fail) throw new Error("offline"); return page([event("saved")]);
  } });
  await controller.refresh(); fail = true;
  assert.equal((await controller.refresh()).ok, false);
  assert.equal(controller.getSnapshot().events[0].id, "saved");
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(controller.getSnapshot().coverage.complete, false);
});

test("selected date, scope, account and auth epoch each create an empty independent row owner", async () => {
  const old = createCalendarShowsController({ query, read: async () => page([event("account-a")]) });
  await old.refresh();
  for (const change of [{ selected: "2026-11-30" }, { scope: "local", homeCity: "Toronto", homeCountry: "CA" }, { accountId: "member-b" }, { authEpoch: 2 }]) {
    const changed = calendarShowsQuery({ ...options, ...change });
    assert.notEqual(changed.key, query.key);
    const controller = createCalendarShowsController({ query: changed, read: async () => page([]) });
    assert.deepEqual(controller.getSnapshot().events, []);
  }
});

test("late completion after route cover, owner retirement, or account change cannot populate rows", async () => {
  for (const retire of ["pause", "dispose", "ownership"]) {
    const pending = deferred(); let owned = true;
    const controller = createCalendarShowsController({ query, read: () => pending.promise });
    const request = controller.refresh({ current: () => owned });
    if (retire === "ownership") owned = false; else controller[retire]();
    pending.resolve(page([event("stale")]));
    assert.equal((await request).value, null);
    assert.deepEqual(controller.getSnapshot().events, []);
  }
});

test("aborted refresh restores settled rows even when it superseded another refresh", async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const controller = createCalendarShowsController({ query, read: () => ++calls === 1 ? Promise.resolve(page([event("settled")])) : calls === 2 ? first.promise : second.promise });
  await controller.refresh();
  const refreshA = controller.refresh();
  const signal = new AbortController();
  const refreshB = controller.refresh({ signal: signal.signal });
  signal.abort(); second.resolve(page([event("cancelled")]));
  assert.equal((await refreshB).value, null);
  first.resolve(page([event("superseded")])); await refreshA;
  assert.equal(controller.getSnapshot().status, "ready");
  assert.deepEqual(controller.getSnapshot().events.map(row => row.id), ["settled"]);
});

test("duplicate or cyclic cursors fail visibly without losing previous rows", async () => {
  const pages = [page([event("one")], "a"), page([event("two")], "b"), page([event("three")], "a")];
  const controller = createCalendarShowsController({ query, read: async () => pages.shift() });
  await controller.refresh(); await controller.loadMore();
  assert.equal((await controller.loadMore()).ok, false);
  assert.deepEqual(controller.getSnapshot().events.map(row => row.id), ["one", "two"]);
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(controller.getSnapshot().hasMore, true);
});

test("plans, missing Local location and inactive ownership start no public query", async () => {
  let calls = 0;
  for (const args of [{ scope: "plans" }, { scope: "local" }, { enabled: false }]) {
    const controller = createCalendarShowsController({ query: calendarShowsQuery({ ...options, ...args }), read: async () => { calls += 1; return page(); } });
    await controller.refresh(); await controller.loadMore();
    assert.equal(controller.getSnapshot().status, "idle");
  }
  const controller = createCalendarShowsController({ query, read: async () => { calls += 1; return page(); } });
  await controller.refresh({ current: () => false });
  assert.equal(calls, 0);
});

test("repeated pagination clicks share one in-flight page, and overlap updates preserve exact ids", async () => {
  const pending = deferred(); let calls = 0;
  const controller = createCalendarShowsController({ query, read: () => ++calls === 1 ? Promise.resolve(page([event("one")], "a")) : pending.promise });
  await controller.refresh();
  const more = controller.loadMore();
  assert.equal((await controller.loadMore()).value, null);
  pending.resolve(page([event("one", { eventStatus: "rescheduled" }), event("two")])); await more;
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().events.length, 2);
  assert.equal(controller.getSnapshot().events[0].eventStatus, "rescheduled");
});
