import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectProfileTimeline } from "../../domain/profileTimeline.mjs";
import {
  createProfileHistoryStore,
  mergeProfileHistoryPage,
  profileHistoryScope,
} from "./profileHistoryState.mjs";

const post = (id, createdAt, date = "") => ({ id, createdAt, date, kind: "review", artist: id, venue: "Pit", overall: 4 });

test("profile history pages append deterministically without duplicates or older-page eviction", () => {
  const first = [post("p6", 6), post("p5", 5), post("p4", 4)];
  const appended = mergeProfileHistoryPage(first, [post("p4", 4), post("p3", 3), post("p2", 2)]);
  assert.deepEqual(appended.map(({ id }) => id), ["p6", "p5", "p4", "p3", "p2"]);

  const refreshed = mergeProfileHistoryPage(appended, [post("p7", 7), post("p6", 6), post("p5", 5)], {
    refresh: true,
    nextCursor: "older-page",
  });
  assert.deepEqual(refreshed.map(({ id }) => id), ["p7", "p6", "p5", "p4", "p3", "p2"]);

  const complete = mergeProfileHistoryPage(refreshed, [post("only", 8)], { refresh: true, nextCursor: null });
  assert.deepEqual(complete.map(({ id }) => id), ["only"]);
});

test("empty snapshots are referentially stable for useSyncExternalStore", () => {
  const store = createProfileHistoryStore({ fetchPage: async () => ({ posts: [], nextCursor: null }) });
  const scope = profileHistoryScope("viewer", "target");
  assert.equal(store.getSnapshot(scope), store.getSnapshot(scope));
});

test("account-scoped post transforms reconcile mutations without touching another viewer cache", () => {
  const store = createProfileHistoryStore({ fetchPage: async () => ({ posts: [], nextCursor: null }) });
  const a = { accountId: "viewer-a", targetId: "author" };
  const b = { accountId: "viewer-b", targetId: "author" };
  const tagged = { ...post("tagged", 1), taggedPeople: [{ id: "viewer-a" }, { id: "friend" }] };
  store.upsertPost(a, tagged);
  store.upsertPost(b, tagged);
  store.updatePost(a, tagged.id, (row) => ({ ...row, taggedPeople: row.taggedPeople.filter((person) => person.id !== "viewer-a") }));
  assert.deepEqual(store.getSnapshot(profileHistoryScope("viewer-a", "author")).data.posts[0].taggedPeople, [{ id: "friend" }]);
  assert.deepEqual(store.getSnapshot(profileHistoryScope("viewer-b", "author")).data.posts[0].taggedPeople, [{ id: "viewer-a" }, { id: "friend" }]);
});

test("held-date diary ordering remains correct after multiple publication pages merge", () => {
  const pageOne = [post("published-newest", 300, "2024-01-05"), post("middle", 200, "2026-03-02")];
  const all = mergeProfileHistoryPage(pageOne, [post("published-oldest", 100, "2027-08-10")]);
  assert.deepEqual(selectProfileTimeline(all).map(({ id }) => id), [
    "published-oldest",
    "middle",
    "published-newest",
  ]);
});

test("account and target scopes isolate results and abandoning a scope aborts its request", async () => {
  const pending = [];
  const store = createProfileHistoryStore({
    fetchPage: ({ accountId, targetId, signal }) => new Promise((resolve, reject) => {
      const call = { accountId, targetId, signal, resolve };
      pending.push(call);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const scopeA = profileHistoryScope("viewer-a", "target-a");
  const scopeB = profileHistoryScope("viewer-b", "target-b");
  const releaseA = store.subscribe(scopeA, () => {});
  const requestA = store.refresh({ accountId: "viewer-a", targetId: "target-a" });
  releaseA();
  assert.equal(pending[0].signal.aborted, true);

  const releaseB = store.subscribe(scopeB, () => {});
  const requestB = store.refresh({ accountId: "viewer-b", targetId: "target-b" });
  pending[1].resolve({ posts: [post("b-only", 2)], nextCursor: null });
  await requestB;
  await requestA;
  assert.deepEqual(store.getSnapshot(scopeB).data.posts.map(({ id }) => id), ["b-only"]);
  assert.deepEqual(store.getSnapshot(scopeA).data.posts, []);
  releaseB();
});

test("a newer same-scope refresh wins even if an older response finishes later", async () => {
  const pending = [];
  const store = createProfileHistoryStore({
    fetchPage: ({ signal }) => new Promise((resolve) => pending.push({ signal, resolve })),
  });
  const params = { accountId: "viewer", targetId: "target" };
  const scope = profileHistoryScope(params.accountId, params.targetId);
  const release = store.subscribe(scope, () => {});
  const older = store.refresh(params);
  const newer = store.refresh(params);
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ posts: [post("new", 2)], nextCursor: null });
  await newer;
  pending[0].resolve({ posts: [post("stale", 3)], nextCursor: null });
  await older;
  assert.deepEqual(store.getSnapshot(scope).data.posts.map(({ id }) => id), ["new"]);
  release();
});

test("an older in-flight response cannot overwrite a newer upsert or removal", async () => {
  const pending = [];
  const store = createProfileHistoryStore({
    fetchPage: ({ signal }) => new Promise((resolve) => pending.push({ signal, resolve })),
  });
  const params = { accountId: "viewer", targetId: "viewer" };
  const scope = profileHistoryScope("viewer", "viewer");
  const release = store.subscribe(scope, () => {});

  const first = store.refresh(params);
  store.upsertPost(params, post("p_local_pending", 20));
  pending[0].resolve({ posts: [], nextCursor: null });
  await first;
  assert.deepEqual(store.getSnapshot(scope).data.posts.map(({ id }) => id), ["p_local_pending"]);

  store.upsertPost(params, post("delete-me", 10));
  const second = store.refresh(params);
  store.removePost(params, "delete-me");
  pending[1].resolve({ posts: [post("delete-me", 10)], nextCursor: null });
  await second;
  assert.deepEqual(store.getSnapshot(scope).data.posts.map(({ id }) => id), ["p_local_pending"]);
  release();
});

test("bounded LRU keeps listened scopes and evicts the oldest inactive scope with its overlays", async () => {
  const calls = new Map();
  const store = createProfileHistoryStore({
    maxEntries: 2,
    now: () => 1_000,
    fetchPage: async ({ targetId }) => {
      calls.set(targetId, (calls.get(targetId) || 0) + 1);
      return { posts: [post(`server-${targetId}`, 10)], nextCursor: null };
    },
  });
  const pinned = { accountId: "viewer", targetId: "pinned" };
  const evicted = { accountId: "viewer", targetId: "evicted" };
  const newest = { accountId: "viewer", targetId: "newest" };
  const releasePinned = store.subscribe(profileHistoryScope(pinned.accountId, pinned.targetId), () => {});

  await store.refresh(pinned);
  await store.refresh(evicted);
  store.upsertPost(evicted, post("local-overlay", 20));
  await store.refresh(newest);

  await store.ensure(pinned, { maxAgeMs: 10_000 });
  assert.equal(calls.get("pinned"), 1, "a listened scope must remain cached");
  await store.ensure(evicted, { maxAgeMs: 10_000 });
  assert.equal(calls.get("evicted"), 2, "the oldest inactive scope must be fetched again");
  assert.deepEqual(
    store.getSnapshot(profileHistoryScope(evicted.accountId, evicted.targetId)).data.posts.map(({ id }) => id),
    ["server-evicted"],
    "eviction must discard the scope's optimistic overlay too",
  );
  releasePinned();
});

test("bounded LRU never aborts an active scope to make room", async () => {
  let pending;
  const store = createProfileHistoryStore({
    maxEntries: 1,
    fetchPage: ({ signal }) => new Promise((resolve) => { pending = { resolve, signal }; }),
  });
  const activeParams = { accountId: "viewer", targetId: "active" };
  const request = store.refresh(activeParams);
  store.upsertPost({ accountId: "viewer", targetId: "other" }, post("other", 1));
  assert.equal(pending.signal.aborted, false);
  pending.resolve({ posts: [post("active", 2)], nextCursor: null });
  await request;
  assert.deepEqual(
    store.getSnapshot(profileHistoryScope("viewer", "active")).data.posts.map(({ id }) => id),
    ["active"],
  );
});

test("account invalidation forces a fresh read without expiring another account", async () => {
  const calls = new Map();
  const store = createProfileHistoryStore({
    now: () => 5_000,
    fetchPage: async ({ accountId, targetId }) => {
      const key = `${accountId}:${targetId}`;
      calls.set(key, (calls.get(key) || 0) + 1);
      return { posts: [post(`${key}:${calls.get(key)}`, calls.get(key))], nextCursor: null };
    },
  });
  const accountA = { accountId: "viewer-a", targetId: "artist" };
  const accountB = { accountId: "viewer-b", targetId: "artist" };
  await store.refresh(accountA);
  await store.refresh(accountB);

  assert.equal(store.invalidateAccount("viewer-a"), 1);
  await store.ensure(accountA, { maxAgeMs: 100_000 });
  await store.ensure(accountB, { maxAgeMs: 100_000 });
  assert.equal(calls.get("viewer-a:artist"), 2);
  assert.equal(calls.get("viewer-b:artist"), 1);
});

test("account scrub removes blocked authors and tags from cached pages and optimistic overlays", async () => {
  const blockedId = "blocked";
  const staleRows = {
    author: [{ ...post("blocked-post", 4), userId: blockedId }],
    friend: [{ ...post("friend-post", 3), userId: "friend", taggedPeople: [{ id: blockedId }, { id: "safe" }] }],
  };
  const calls = new Map();
  const store = createProfileHistoryStore({
    now: () => 8_000,
    fetchPage: async ({ accountId, targetId }) => {
      const key = `${accountId}:${targetId}`;
      calls.set(key, (calls.get(key) || 0) + 1);
      if (accountId === "viewer-a" && calls.get(key) > 1) {
        if (targetId === "author") return { posts: [], nextCursor: null };
        if (targetId === "friend") {
          return { posts: [{ ...staleRows.friend[0], taggedPeople: [{ id: "safe" }] }], nextCursor: null };
        }
      }
      return { posts: staleRows[targetId] || [], nextCursor: null };
    },
  });
  const author = { accountId: "viewer-a", targetId: "author" };
  const friend = { accountId: "viewer-a", targetId: "friend" };
  const otherViewer = { accountId: "viewer-b", targetId: "friend" };
  await store.refresh(author);
  await store.refresh(friend);
  await store.refresh(otherViewer);

  const withoutBlockedIdentity = (row) => {
    if (row?.userId === blockedId) return null;
    const taggedPeople = Array.isArray(row?.taggedPeople)
      ? row.taggedPeople.filter((person) => person?.id !== blockedId)
      : row?.taggedPeople;
    return taggedPeople === row?.taggedPeople || taggedPeople?.length === row?.taggedPeople?.length
      ? row
      : { ...row, taggedPeople };
  };
  assert.equal(store.scrubAccount("viewer-a", withoutBlockedIdentity), 2);
  assert.deepEqual(store.getSnapshot(profileHistoryScope("viewer-a", "author")).data.posts, []);
  assert.deepEqual(
    store.getSnapshot(profileHistoryScope("viewer-a", "friend")).data.posts[0].taggedPeople,
    [{ id: "safe" }],
  );
  assert.deepEqual(
    store.getSnapshot(profileHistoryScope("viewer-b", "friend")).data.posts[0].taggedPeople,
    [{ id: blockedId }, { id: "safe" }],
    "another viewer's account-scoped cache must remain untouched",
  );

  // Scrub invalidates these otherwise-fresh scopes, so the next navigation reads
  // the authoritative post-block projection instead of trusting cached pages.
  await store.ensure(author, { maxAgeMs: 100_000 });
  await store.ensure(friend, { maxAgeMs: 100_000 });
  assert.equal(calls.get("viewer-a:author"), 2);
  assert.equal(calls.get("viewer-a:friend"), 2);
  assert.deepEqual(store.getSnapshot(profileHistoryScope("viewer-a", "author")).data.posts, []);
  assert.deepEqual(
    store.getSnapshot(profileHistoryScope("viewer-a", "friend")).data.posts[0].taggedPeople,
    [{ id: "safe" }],
  );
});

test("account reset aborts reads and clears only that account, including mounted scopes", async () => {
  let pending;
  let notifications = 0;
  const store = createProfileHistoryStore({
    fetchPage: ({ signal }) => new Promise((resolve, reject) => {
      pending = { signal, resolve };
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const accountA = { accountId: "viewer-a", targetId: "artist" };
  const accountB = { accountId: "viewer-b", targetId: "artist" };
  const release = store.subscribe(profileHistoryScope("viewer-a", "artist"), () => { notifications += 1; });
  store.upsertPost(accountB, post("b-only", 1));
  const request = store.refresh(accountA);
  assert.equal(store.resetAccount("viewer-a"), 1);
  assert.equal(pending.signal.aborted, true);
  await request;
  assert.ok(notifications >= 1);
  assert.deepEqual(store.getSnapshot(profileHistoryScope("viewer-a", "artist")).data.posts, []);
  assert.deepEqual(store.getSnapshot(profileHistoryScope("viewer-b", "artist")).data.posts.map(({ id }) => id), ["b-only"]);
  release();
});

test("the shared Store deletion path removes posts from dedicated profile history", () => {
  const source = readFileSync(new URL("../../store.js", import.meta.url), "utf8");
  const start = source.indexOf("const deleteOwnPost =");
  const end = source.indexOf("const removeMyPostTag", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /removeProfileHistoryPost\(session\.id, session\.id, postId\)/);
  assert.match(source.slice(start, end), /upsertProfileHistoryPost\(session\.id, session\.id, removed\)/);
});

test("the shared Store rotates profile history at auth boundaries and scrubs it after a confirmed block", () => {
  const source = readFileSync(new URL("../../store.js", import.meta.url), "utf8");
  assert.match(source, /adoptProfileHistoryAccount,/);
  assert.match(source, /resetProfileHistoryAccount,/);
  assert.match(source, /scrubBlockedProfileHistoryPerson,/);

  const adoptStart = source.indexOf("const adoptFeedAccount =");
  const adoptEnd = source.indexOf("useEffect(() => {", adoptStart);
  assert.ok(adoptStart >= 0 && adoptEnd > adoptStart);
  assert.match(source.slice(adoptStart, adoptEnd), /adoptProfileHistoryAccount\(nextAccountId\)/);

  const blockStart = source.indexOf("const blockUser =");
  const blockEnd = source.indexOf("const unblockUser =", blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(source.slice(blockStart, blockEnd), /\.then\(\(\) => \{\s*scrubBlockedProfileHistoryPerson\(accountId, id\)/);
  assert.match(source.slice(blockStart, blockEnd), /sessionRef\.current\?\.id !== accountId/);

  const unblockStart = blockEnd;
  const unblockEnd = source.indexOf("const blockedUsers =", unblockStart);
  assert.ok(unblockEnd > unblockStart);
  assert.match(source.slice(unblockStart, unblockEnd), /\.then\(\(\) => \{[\s\S]*resetProfileHistoryAccount\(accountId\)/);
});
