import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureAccountMutation } from "./accountMutation.mjs";

import {
  PROFILE_LOAD_ERROR,
  PROFILE_STALE_MESSAGE,
  assertCurrentProfileRead,
  profileFailureOutcome,
  reconcileProfilePostSnapshot,
  unavailableProfileOutcome,
  withoutUnavailableProfile,
  withoutUnavailableProfilePosts,
} from "./profileReadState.mjs";

const cachedUsers = [{ id: "u_visible", name: "Visible" }, { id: "u_target", name: "Cached target" }];
const cachedPosts = [
  { id: "p_visible", userId: "u_visible", photos: ["visible.jpg"] },
  { id: "p_target", userId: "u_target", photos: ["private.jpg"] },
];

test("cached profiles and their media are quarantined after authoritative 403, 404, or 410", () => {
  for (const status of [403, 404, 410]) {
    const outcome = profileFailureOutcome({ status }, { hasCachedProfile: true });
    assert.equal(outcome.status, "missing");
    assert.equal(outcome.evict, true);
    assert.deepEqual(withoutUnavailableProfile(cachedUsers, "u_target"), [{ id: "u_visible", name: "Visible" }]);
    assert.deepEqual(withoutUnavailableProfilePosts(cachedPosts, "u_target"), [{ id: "p_visible", userId: "u_visible", photos: ["visible.jpg"] }]);
  }
  assert.equal(unavailableProfileOutcome().evict, true);
});

test("transient failure keeps a cached profile only as explicitly stale data", () => {
  const outcome = profileFailureOutcome({ status: 503 }, { hasCachedProfile: true });
  assert.deepEqual(outcome, {
    status: "stale",
    reason: "refresh-failed",
    evict: false,
    user: null,
    error: PROFILE_STALE_MESSAGE,
  });
  assert.equal(cachedUsers.length, 2);
  assert.equal(cachedPosts.length, 2);
});

test("transient failure without a cache is a retryable load error, not not-found", () => {
  const outcome = profileFailureOutcome(new TypeError("Failed to fetch"));
  assert.equal(outcome.status, "error");
  assert.equal(outcome.evict, false);
  assert.equal(outcome.error, PROFILE_LOAD_ERROR);
});

test("an authoritative wall snapshot removes stale confirmed media but preserves local pending work", () => {
  const rows = [
    ...cachedPosts,
    { id: "p_kept", userId: "u_target" },
    { id: "p_local_new", userId: "u_target", pending: true },
  ];
  assert.deepEqual(reconcileProfilePostSnapshot(rows, "u_target", [{ id: "p_kept" }]).map((post) => post.id), [
    "p_visible",
    "p_kept",
    "p_local_new",
  ]);
  assert.equal(reconcileProfilePostSnapshot(rows, "u_target", null), rows);
  assert.deepEqual(reconcileProfilePostSnapshot(rows, "u_target", []).map((post) => post.id), [
    "p_visible",
    "p_local_new",
  ]);
});

test("the store evicts only authoritative misses and the screen labels retained stale cache", () => {
  const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const screenSource = readFileSync(new URL("../screens/ProfileScreen.jsx", import.meta.url), "utf8");
  const start = storeSource.indexOf("const loadUser =");
  const end = storeSource.indexOf("// Recent searches", start);
  assert.ok(start >= 0 && end > start, "typed profile loader should be present");
  const loader = storeSource.slice(start, end);

  assert.match(loader, /const outcome = profileFailureOutcome/);
  assert.match(loader, /if \(outcome\.evict\) quarantine\(\)/);
  assert.match(loader, /withoutUnavailableProfilePosts/);
  assert.doesNotMatch(loader, /\/posts/);
  assert.match(screenSource, /useProfileHistory/);
  assert.match(screenSource, /profileView\.status === "missing"/);
  assert.match(screenSource, /profileView\.status === "stale"/);
  assert.match(screenSource, /styles\.staleProfileText\}>\{profileView\.error\}/);
});

const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const loadUserStart = storeSource.indexOf("const loadUser =");
const loadUserEnd = storeSource.indexOf("// Recent searches", loadUserStart);
assert.ok(loadUserStart >= 0 && loadUserEnd > loadUserStart);
const loadUserSource = storeSource.slice(loadUserStart, loadUserEnd);

function profileHarness() {
  const state = { users: [...cachedUsers], posts: [...cachedPosts], stats: {}, follows: {} };
  const sessionRef = { current: { id: "A" } };
  const accountMutationEpochRef = { current: 1 };
  const calls = [];
  const load = (id, options) => {
    const dependencies = {
      sessionRef, accountMutationEpochRef, captureAccountMutation, assertCurrentProfileRead,
      unavailableProfileOutcome, profileFailureOutcome, withoutUnavailableProfile, withoutUnavailableProfilePosts,
      session: sessionRef.current, follows: state.follows,
      userById: (target) => state.users.find((user) => user.id === target),
      api: (url, requestOptions) => new Promise((resolve, reject) => calls.push({ url, options: requestOptions, resolve, reject })),
      setUsers: (update) => { state.users = update(state.users); },
      setFeed: (update) => { state.posts = update(state.posts); },
      setUserStats: (update) => { state.stats = update(state.stats); },
      setFollows: (update) => { state.follows = update(state.follows); },
      absorbUsers: (users) => { state.users = [...state.users.filter((row) => !users.some((user) => row.id === user.id)), ...users]; },
    };
    const reader = new Function(...Object.keys(dependencies), `"use strict"; ${loadUserSource}; return loadUser;`)(...Object.values(dependencies));
    return reader(id, options);
  };
  return { state, sessionRef, accountMutationEpochRef, calls, load };
}

test("prior-account profile successes and access denials cannot publish or quarantine current data", async () => {
  for (const status of [null, 403, 404, 410]) {
    const h = profileHarness();
    const oldRead = h.load("u_target");
    h.sessionRef.current = { id: "B" };
    h.accountMutationEpochRef.current += 1;
    const currentRead = h.load("u_target");
    h.calls[1].resolve({ user: { id: "u_target", name: "B-authorized profile" }, followers: 5, following: 3, isFollowing: true });
    assert.equal((await currentRead).status, "ready");
    const before = structuredClone(h.state);
    if (status) h.calls[0].reject({ status });
    else h.calls[0].resolve({ user: { id: "u_target", name: "Old A-only data" }, followers: 99, isFollowing: true });
    await assert.rejects(oldRead, { name: "AbortError" });
    assert.deepEqual(h.state, before);
    assert.deepEqual(h.state.follows, { B: ["u_target"] });
    assert.deepEqual(h.state.stats.u_target, { followers: 5, following: 3 });
  }
});

test("current-account authoritative profile denials still quarantine the cached profile and posts", async () => {
  const h = profileHarness();
  const read = h.load("u_target");
  h.calls[0].reject({ status: 403 });
  const outcome = await read;
  assert.equal(outcome.status, "missing");
  assert.equal(outcome.evict, true);
  assert.deepEqual(h.state.users.map((user) => user.id), ["u_visible"]);
  assert.deepEqual(h.state.posts.map((post) => post.id), ["p_visible"]);
});

test("cancelled or identity-changed profile requests do not downgrade a cached profile", async () => {
  for (const kind of ["abort", "identity", "roundtrip"]) {
    const h = profileHarness();
    const controller = new AbortController();
    const read = h.load("u_target", { signal: controller.signal });
    if (kind === "roundtrip") h.accountMutationEpochRef.current += 2;
    if (kind === "abort") controller.abort();
    const before = structuredClone(h.state);
    if (kind === "identity") h.calls[0].reject({ status: 409, serverCode: "IDENTITY_CHANGED" });
    else h.calls[0].resolve({ user: null });
    await assert.rejects(read, { name: "AbortError" });
    assert.deepEqual(h.state, before);
  }
});
