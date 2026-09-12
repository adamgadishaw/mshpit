import test from "node:test";
import assert from "node:assert/strict";
import { createConcertHistoryResource } from "./concertHistoryLoader.mjs";
import { concertHistoryRequest, concertHistoryResponse } from "./concertHistoryRequest.mjs";

const row = (id, patch = {}) => ({ id, postId: id, artist: "The Sheepdogs", venue: "History", city: "Toronto", date: "2025-07-07", lat: 43.7, lng: -79.4, country: "Canada", countryCode: "CA", ...patch });
const page = (concerts, cursor = null, patch = {}) => ({ concerts, nextCursor: cursor, hasMore: !!cursor, complete: !cursor, mapVisible: true, ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("concert history requests bind the viewer and encode profile/cursor without using feed pagination", () => {
  const request = concertHistoryRequest({ accountId: "viewer", targetId: "member/one", before: "opaque+=/" });
  assert.equal(request.expectedAccountId, "viewer");
  assert.equal(request.path, "/api/users/member%2Fone/concert-history?limit=200&before=opaque%2B%3D%2F");
  assert.equal(concertHistoryRequest({ targetId: "member" }).expectedAccountId, null);
  assert.throws(() => concertHistoryRequest({ targetId: "" }));
  assert.throws(() => concertHistoryRequest({ targetId: "member", before: "" }));
});

test("concert response rejects malformed pagination and scrubs invalid or hidden coordinates", () => {
  for (const payload of [null, {}, page([], "next", { hasMore: false }), page([], null, { complete: false }), page([row("x", { date: "bad" })])]) {
    assert.throws(() => concertHistoryResponse(payload));
  }
  for (const patch of [{ lat: null }, { lat: "43.7" }, { lng: Infinity }, { lng: 181 }]) {
    const result = concertHistoryResponse(page([row("x", patch)]));
    assert.equal(result.concerts[0].lat, null);
    assert.equal(result.concerts[0].countryCode, null);
  }
  const result = concertHistoryResponse(page([row("x")], null, { mapVisible: false }));
  assert.equal(result.concerts[0].lat, null);
  assert.equal(result.concerts[0].country, null);
});

test("all history drains beyond the feed's first page including empty eligible pages", async () => {
  const cursors = [];
  const resource = createConcertHistoryResource({ requestPage: async ({ before }) => {
    cursors.push(before);
    return before === null ? page(Array.from({ length: 200 }, (_, i) => row(`p${i}`)), "cursor1")
      : before === "cursor1" ? page([], "cursor2") : page([row("oldest")]);
  } });
  await resource.loadMore();
  assert.deepEqual(cursors, [null, "cursor1", "cursor2"]);
  assert.equal(resource.getSnapshot().concerts.length, 201);
  assert.equal(resource.getSnapshot().complete, true);
});

test("automatic loading is bounded and continuation reaches older history without truncation", async () => {
  let calls = 0;
  const resource = createConcertHistoryResource({ requestPage: async () => { calls++; return page([row(`p${calls}`)], calls < 7 ? `c${calls}` : null); } });
  await resource.loadMore();
  assert.equal(calls, 5);
  assert.equal(resource.getSnapshot().complete, false);
  await resource.loadMore();
  assert.equal(calls, 7);
  assert.equal(resource.getSnapshot().concerts.length, 7);
  assert.equal(resource.getSnapshot().complete, true);
});

test("double-load shares one flight and duplicate rows merge; repeated cursors fail visibly", async () => {
  const pending = deferred();
  let calls = 0;
  const resource = createConcertHistoryResource({ requestPage: async () => { calls++; return calls === 1 ? pending.promise : page([row("x")], "repeat"); } });
  const first = resource.loadMore(), second = resource.loadMore();
  assert.equal(first, second);
  assert.equal(calls, 1);
  pending.resolve(page([row("x")], "repeat"));
  await first;
  assert.equal(resource.getSnapshot().concerts.length, 1);
  assert.equal(resource.getSnapshot().status, "error");
  assert.equal(resource.getSnapshot().loadingMore, false);
});

test("map privacy changing mid-pagination strips earlier pins too", async () => {
  let calls = 0;
  const resource = createConcertHistoryResource({ requestPage: async () => ++calls === 1 ? page([row("first")], "next") : page([row("second")], null, { mapVisible: false }) });
  await resource.loadMore();
  assert.equal(resource.getSnapshot().mapVisible, false);
  for (const item of resource.getSnapshot().concerts) {
    assert.equal(item.lat, null);
    assert.equal(item.countryCode, null);
  }
});

test("temporary failures preserve earlier history and retry the failed page", async () => {
  let calls = 0;
  const seen = [];
  const resource = createConcertHistoryResource({ requestPage: async ({ before }) => {
    seen.push(before); calls++;
    if (calls === 2) throw new Error("offline");
    return calls === 1 ? page([row("first")], "next") : page([row("second")]);
  } });
  await resource.loadMore();
  assert.equal(resource.getSnapshot().concerts.length, 1);
  assert.equal(resource.getSnapshot().status, "error");
  await resource.retry();
  assert.deepEqual(seen, [null, "next", "next"]);
  assert.equal(resource.getSnapshot().concerts.length, 2);
  assert.equal(resource.getSnapshot().error, "");
});

test("access revocation clears all previously loaded history and geographic data", async () => {
  for (const status of [401, 403, 404, 409]) {
    let calls = 0;
    const resource = createConcertHistoryResource({ requestPage: async () => {
      if (++calls > 1) throw Object.assign(new Error("denied"), { status });
      return page([row("first")], "next");
    } });
    await resource.loadMore();
    assert.deepEqual(resource.getSnapshot().concerts, []);
    assert.equal(resource.getSnapshot().mapVisible, false);
  }
});

test("profile/account disposal aborts work and ignores late success", async () => {
  const pending = deferred(); let signal;
  const resource = createConcertHistoryResource({ requestPage: (options) => { signal = options.signal; return pending.promise; } });
  const flight = resource.loadMore();
  resource.dispose();
  assert.equal(signal.aborted, true);
  pending.resolve(page([row("private")]));
  await flight;
  assert.deepEqual(resource.getSnapshot().concerts, []);
});

test("strict effect replay can restart a cancelled load without the old flight winning", async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const resource = createConcertHistoryResource({ requestPage: () => ++calls === 1 ? old.promise : fresh.promise });
  const first = resource.loadMore(); resource.dispose(); resource.activate();
  const second = resource.loadMore();
  old.resolve(page([row("old")])); await first;
  assert.equal(resource.loadMore(), second);
  fresh.resolve(page([row("fresh")])); await second;
  assert.deepEqual(resource.getSnapshot().concerts.map((item) => item.id), ["fresh"]);
});

test("opening fetches the exact original review and rejects a wrong or late post", async () => {
  let opened = null;
  const resource = createConcertHistoryResource({ requestPage: async () => page([]), readPost: async (id) => ({ id, text: "Original full review" }) });
  await resource.openConcert(row("full-post"), (post) => { opened = post; });
  assert.equal(opened.text, "Original full review");
  const wrong = createConcertHistoryResource({ readPost: async () => ({ id: "another" }) });
  await wrong.openConcert(row("requested"), () => assert.fail("Wrong review opened"));
  assert.ok(wrong.getSnapshot().openingError);
  assert.equal(wrong.getSnapshot().openingId, null);
  const pending = deferred(); let signal;
  const stale = createConcertHistoryResource({ readPost: (id, opts) => { signal = opts.signal; return pending.promise; } });
  const flight = stale.openConcert(row("private"), () => assert.fail("Old account navigated"));
  stale.dispose(); assert.equal(signal.aborted, true);
  pending.resolve({ id: "private" }); await flight;
});

test("removing a post immediately removes its history row", async () => {
  const resource = createConcertHistoryResource({ requestPage: async () => page([row("deleted"), row("kept")]) });
  await resource.loadMore(); resource.removePost("deleted");
  assert.deepEqual(resource.getSnapshot().concerts.map((item) => item.id), ["kept"]);
});

test("deleting a review during pagination cannot resurrect it from an in-flight page", async () => {
  const pending = deferred(); let calls = 0;
  const resource = createConcertHistoryResource({ requestPage: async () => ++calls === 1 ? page([row("deleted")], "next") : pending.promise });
  const flight = resource.loadMore();
  await new Promise((resolve) => setImmediate(resolve));
  resource.removePost("deleted");
  pending.resolve(page([row("deleted"), row("kept")]));
  await flight;
  assert.deepEqual(resource.getSnapshot().concerts.map((item) => item.id), ["kept"]);
});

test("pull-to-refresh cancels an old batch and reconciles from the head", async () => {
  const pending = deferred(); let calls = 0, firstSignal;
  const resource = createConcertHistoryResource({ requestPage: ({ before, signal }) => {
    calls++;
    if (calls === 1) { firstSignal = signal; return pending.promise; }
    assert.equal(before, null);
    return Promise.resolve(page([row("fresh")]));
  } });
  const first = resource.loadMore();
  await resource.refresh();
  assert.equal(firstSignal.aborted, true);
  pending.resolve(page([row("stale")])); await first;
  assert.equal(calls, 2);
  assert.deepEqual(resource.getSnapshot().concerts.map((item) => item.id), ["fresh"]);
});
