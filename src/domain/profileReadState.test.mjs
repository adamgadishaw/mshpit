import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_LOAD_ERROR,
  PROFILE_STALE_MESSAGE,
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
