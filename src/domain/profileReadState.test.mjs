import { claimIOSProfileRead } from "../lib/iosProfileReadFence.ios.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureAccountMutation, accountMutationIsCurrent } from "./accountMutation.mjs";
import { reconcilePostAuthorBadges, reconcileCommentAuthorBadges } from "./postBadgeBundle.mjs";

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
  const profileReadAuthority = new Map();
  const calls = [], badgeReconciliations = [];
  const authorityDependencies = {
    profileReadAuthority, accountMutationEpochRef, sessionRef,
    feedMutationRevisionRef: { current: 0 }, reconcilePostAuthorBadges, reconcileCommentAuthorBadges,
    setFeed: update => { state.posts = update(state.posts); }, setComments: update => update({}),
    publishAuthorBadgeChange: event => badgeReconciliations.push(structuredClone(event.user)),
  };
  const reconcileStart = storeSource.indexOf("const reconcileAuthorBadges =");
  const reconcileSource = storeSource.slice(reconcileStart, storeSource.indexOf("const absorbUsers =", reconcileStart));
  const confirmAuthority = new Function(...Object.keys(authorityDependencies), `${reconcileSource}; return reconcileAuthorBadges;`)(...Object.values(authorityDependencies));
  const load = (id, options) => {
    const dependencies = {
      Platform: { OS: "ios" },
      invalidateIOSDetailPrivacy: () => 0,
      claimIOSProfileRead, sessionRef, accountMutationEpochRef, profileReadAuthority, captureAccountMutation, assertCurrentProfileRead,
      unavailableProfileOutcome, profileFailureOutcome, withoutUnavailableProfile, withoutUnavailableProfilePosts,
      session: sessionRef.current, follows: state.follows,
      userById: (target) => state.users.find((user) => user.id === target),
      api: (url, requestOptions) => new Promise((resolve, reject) => calls.push({ url, options: requestOptions, resolve, reject })),
      setUsers: (update) => { state.users = update(state.users); },
      setFeed: (update) => { state.posts = update(state.posts); },
      setUserStats: (update) => { state.stats = update(state.stats); },
      setFollows: (update) => { state.follows = update(state.follows); },
      absorbUsers: (users) => { state.users = [...state.users.filter((row) => !users.some((user) => row.id === user.id)), ...users]; },
      reconcileAuthorBadges: confirmAuthority,
    };
    const reader = new Function(...Object.keys(dependencies), `"use strict"; ${loadUserSource}; return loadUser;`)(...Object.values(dependencies));
    return reader(id, options);
  };
  return { state, sessionRef, accountMutationEpochRef, profileReadAuthority, calls, badgeReconciliations, confirmAuthority, load };
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
    assert.deepEqual(h.badgeReconciliations, [{ id: "u_target", name: "B-authorized profile" }]);
    const before = structuredClone(h.state);
    if (status) h.calls[0].reject({ status });
    else h.calls[0].resolve({ user: { id: "u_target", name: "Old A-only data" }, followers: 99, isFollowing: true });
    await assert.rejects(oldRead, { name: "AbortError" });
    assert.equal(h.badgeReconciliations.length, 1, "obsolete profile responses cannot reconcile badges");
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

test("older profile successes and denials cannot undo a newer confirmed revocation", async () => {
  for (const status of [null, 403, 404, 410, 503]) {
    const h = profileHarness();
    const older = h.load("u_target");
    const newer = h.load("u_target");
    h.calls[1].resolve({ user: { id: "u_target", role: "fan", verified: false } });
    await newer;
    const before = structuredClone(h.state);
    if (status) h.calls[0].reject({ status });
    else h.calls[0].resolve({ user: { id: "u_target", role: "admin", verified: true } });
    await assert.rejects(older, { name: "AbortError" });
    assert.deepEqual(h.state, before);
    assert.equal(h.badgeReconciliations.length, 1);
    assert.equal(h.profileReadAuthority.size, 0);
  }
});

test("a confirmed authority change fences only that author's pending profile reads", async () => {
  const h = profileHarness();
  const older = h.load("u_target");
  const unrelated = h.load("u_visible");
  h.confirmAuthority({ id: "u_target", role: "fan", verified: false });
  h.calls[0].resolve({ user: { id: "u_target", role: "admin", verified: true } });
  await assert.rejects(older, { name: "AbortError" });
  h.calls[1].resolve({ user: { id: "u_visible", role: "fan" } });
  assert.equal((await unrelated).status, "ready");
  assert.deepEqual(h.badgeReconciliations.map(user => user.id), ["u_target", "u_visible"]);
  assert.equal(h.profileReadAuthority.size, 0);
});

test("post reads discard delayed results after account changes, round trips, and cancellation", async () => {
  const start = storeSource.indexOf("const loadPostForView =");
  const end = storeSource.indexOf("\n  };", start) + 5;
  for (const change of ["none", "account", "roundtrip", "abort", "revocation", "block", "mute"]) {
    const sessionRef = { current: { id: "A" } }, accountMutationEpochRef = { current: 1 };
    const feedMutationRevisionRef = { current: 0 }, blockedIdsRef = { current: [], mutedIds: [] };
    let resolve, options;
    const deps = {
      sessionRef, accountMutationEpochRef, feedMutationRevisionRef, blockedIdsRef, captureAccountMutation, accountMutationIsCurrent,
      fetchPostById: (_id, requestOptions) => { options = requestOptions; return new Promise(done => { resolve = done; }); },
      normalizeServerPost: post => post,
    };
    const reader = new Function(...Object.keys(deps), `${storeSource.slice(start, end)}; return loadPostForView;`)(...Object.values(deps));
    const controller = new AbortController();
    const pending = reader("p_target", { signal: controller.signal });
    assert.equal(options.expectedAccountId, "A");
    if (change === "account") sessionRef.current = { id: "B" };
    if (change === "roundtrip") accountMutationEpochRef.current += 2;
    if (change === "abort") controller.abort();
    if (change === "revocation") feedMutationRevisionRef.current += 1;
    if (change === "block") blockedIdsRef.current = ["author"];
    if (change === "mute") blockedIdsRef.mutedIds = ["author"];
    const post = { id: "p_target", userId: "author", review: "A's private post" };
    resolve({ post });
    assert.deepEqual(await pending, change === "none" ? post : null);
  }
});

test("iOS profile success cannot resurrect a newer authoritative quarantine, while a fresh read recovers", async () => {
  for (const denial of [403, 404, 410, "missing"]) {
    const h = profileHarness();
    const old = h.load("u_target"), denied = h.load("u_target");
    if (denial === "missing") h.calls[1].resolve({ user: null });
    else h.calls[1].reject({ status: denial });
    assert.equal((await denied).status, "missing");
    const quarantined = structuredClone(h.state);
    h.calls[0].resolve({ user: { id: "u_target", avatarUri: "private.jpg" }, favoriteShows: [{ id: "private-show" }] });
    await assert.rejects(old, { name: "AbortError" });
    assert.deepEqual(h.state, quarantined);
    const fresh = h.load("u_target");
    h.calls[2].resolve({ user: { id: "u_target", name: "Newly authorized" }, favoriteShows: [] });
    assert.equal((await fresh).status, "ready");
    assert.equal(h.state.users.find(user => user.id === "u_target").name, "Newly authorized");
  }
});

test("iOS profile denial fence is target-, Store-, and account-scoped with bounded pending ownership", () => {
  const owner = { current: 1 }, otherOwner = { current: 1 };
  const a = claimIOSProfileRead(owner, "a"), b = claimIOSProfileRead(owner, "b");
  const other = claimIOSProfileRead(otherOwner, "a");
  a.quarantine();
  assert.equal(a.current(), false); assert.equal(b.current(), true); assert.equal(other.current(), true);
  const replacement = claimIOSProfileRead(owner, "a");
  assert.equal(replacement.current(), true);
  owner.current++;
  const account = claimIOSProfileRead(owner, "a");
  replacement.quarantine();
  assert.equal(account.current(), true); assert.equal(replacement.current(), false);
  for (let i = 0; i < 129; i++) claimIOSProfileRead(owner, `bounded-${i}`);
  assert.equal(account.current(), false, "bounded eviction cannot leave an old receipt authorized");
  const reintroduced = claimIOSProfileRead(owner, "a");
  account.quarantine();
  assert.equal(reintroduced.current(), false, "a genuine same-account denial still revokes an evicted/reintroduced target");
  assert.equal(claimIOSProfileRead(owner, "a").current(), true, "an explicit read after that denial may recover");
});
