import assert from "node:assert/strict";
import test from "node:test";

import { reconcileConfirmedNotificationReads } from "./notificationReadMutation.mjs";

test("a confirmed read command clears only its captured account-owned rows", () => {
  const captured = [
    { id: "n-a-1", userId: "account-a", read: false },
    { id: "n-a-2", userId: "account-a", read: false },
    { id: "n-b-1", userId: "account-b", read: false },
  ];
  const concurrent = [...captured, { id: "n-a-new", userId: "account-a", read: false }];
  const next = reconcileConfirmedNotificationReads(concurrent, {
    accountId: "account-a",
    notificationIds: captured.slice(0, 2).map((row) => row.id),
  });
  assert.deepEqual(next.map((row) => [row.id, row.read]), [
    ["n-a-1", true],
    ["n-a-2", true],
    ["n-b-1", false],
    ["n-a-new", false],
  ]);
  assert.equal(reconcileConfirmedNotificationReads(next, { accountId: "account-a", notificationIds: [] }), next);
});

import { confirmedNotificationIds, fetchNotificationHistory, mergeNotificationHistory } from "./notificationReadMutation.mjs";

test("opening activity fetches every cursor page, deduplicates overlap, and keeps history", async () => {
  const paths = [];
  const rows = await fetchNotificationHistory(async (path) => {
    paths.push(path);
    return paths.length === 1
      ? { notifications: [{ id: "new" }, { id: "overlap" }], nextCursor: "older cursor" }
      : { notifications: [{ id: "overlap" }, { id: "old" }], nextCursor: null };
  });
  assert.deepEqual(paths, ["/api/me/notifications", "/api/me/notifications?before=older%20cursor"]);
  assert.deepEqual(rows.map(row => row.id), ["new", "overlap", "old"]);
});

test("history fetch refuses stalled pagination and leaves failed or stale reads unapplied", async () => {
  await assert.rejects(fetchNotificationHistory(async () => ({ notifications: [], nextCursor: "same" })), /did not advance/);
  await assert.rejects(fetchNotificationHistory(async () => { throw new Error("offline"); }), /offline/);
  let current = true;
  const rows = await fetchNotificationHistory(async () => {
    current = false;
    return { notifications: [{ id: "old-account" }], nextCursor: "more" };
  }, { isCurrent: () => current });
  assert.equal(rows, null);
});

test("a confirmed acknowledgement cannot clear concurrent or unconfirmed IDs", () => {
  assert.throws(() => confirmedNotificationIds({ ok: true }, ["first"]), /not confirmed/);
  assert.deepEqual(confirmedNotificationIds({ ok: true, readContract: "notification-ids-v1", notificationIds: ["first", "arrived", "first"] }, ["first"]), ["first"]);
  assert.deepEqual(confirmedNotificationIds({ ok: true, readContract: "notification-ids-v1", notificationIds: [] }, ["first"]), []);
});

test("history refresh preserves concurrent arrivals and confirmed reads without reviving removed history", () => {
  const initial = [{ id: "seen", userId: "a", read: false }, { id: "removed", userId: "a", read: false }];
  const current = [{ ...initial[0], read: true }, initial[1], { id: "arrived", userId: "a", read: false }, { id: "other", userId: "b" }];
  const result = mergeNotificationHistory(current, [{ id: "seen", read: false }, { id: "older", read: true }], { accountId: "a", capturedRows: initial });
  assert.deepEqual(result.map(row => [row.id, row.read]), [["seen", true], ["older", true], ["arrived", false], ["other", undefined]]);
});
