import assert from "node:assert/strict";
import test from "node:test";
import {
  directMessageIsAfterCursor,
  directMessageUnreadCount,
  latestDirectMessageReadCursor,
  latestIncomingDirectMessageId,
  normalizeDirectMessageReadCursor,
  mergeDirectMessageReadSummary,
} from "./directMessageRead.mjs";

test("direct-message cursors use timestamp and id ordering", () => {
  const cursor = { createdAt: 100, id: "dm_b" };
  assert.equal(directMessageIsAfterCursor({ at: 99, id: "dm_z" }, cursor), false);
  assert.equal(directMessageIsAfterCursor({ at: 100, id: "dm_a" }, cursor), false);
  assert.equal(directMessageIsAfterCursor({ at: 100, id: "dm_c" }, cursor), true);
  assert.equal(directMessageIsAfterCursor({ at: 101, id: "dm_a" }, cursor), true);
});

test("cursor reconciliation cannot move a locally confirmed read position backwards", () => {
  assert.deepEqual(
    latestDirectMessageReadCursor({ createdAt: 101, id: "dm_a" }, { createdAt: 100, id: "dm_z" }),
    { createdAt: 101, id: "dm_a" },
  );
  assert.deepEqual(
    latestDirectMessageReadCursor({ createdAt: 100, id: "dm_a" }, { createdAt: 100, id: "dm_b" }),
    { createdAt: 100, id: "dm_b" },
  );
});

test("unread counts include only incoming messages after the durable cursor", () => {
  const messages = [
    { id: "dm_a", from: "other", at: 100 },
    { id: "dm_b", from: "me", at: 101 },
    { id: "dm_c", from: "other", at: 102 },
  ];
  assert.equal(directMessageUnreadCount(messages, {
    accountId: "me",
    cursor: { createdAt: 100, id: "dm_a" },
  }), 1);
  assert.equal(directMessageUnreadCount(messages, { accountId: "me", cursor: null }), 2);
});

test("invalid cursors cannot hide messages and demo count markers remain compatible", () => {
  assert.equal(normalizeDirectMessageReadCursor({ createdAt: "bad", id: "dm_a" }), null);
  const messages = [{ id: "a", from: "other" }, { id: "b", from: "me" }, { id: "c", from: "other" }];
  assert.equal(directMessageUnreadCount(messages, { accountId: "me", legacyReadCount: 2 }), 1);
});

test("outgoing optimistic messages do not advance the inbound read target", () => {
  const messages = [
    { id: "dm_in_1", from: "other", at: 100 },
    { id: "dm_out_1", from: "me", at: 101, pending: true },
  ];
  assert.equal(latestIncomingDirectMessageId(messages, "me"), "dm_in_1");
  assert.equal(
    latestIncomingDirectMessageId([...messages, { id: "dm_out_2", from: "me", at: 102, pending: true }], "me"),
    "dm_in_1",
  );
  assert.equal(
    latestIncomingDirectMessageId([...messages, { id: "dm_in_2", from: "other", at: 103 }], "me"),
    "dm_in_2",
  );
  assert.equal(latestIncomingDirectMessageId([{ id: "unknown_sender", at: 104 }], "me"), null);
  assert.equal(latestIncomingDirectMessageId(messages, null), null);
});

test("authoritative full-history totals are independent of cache windows and outgoing previews", () => {
  const boundary = { createdAt: 1200, id: "m1200" };
  const marker = mergeDirectMessageReadSummary(null, { readCursor: null, unread: 1200, latestIncomingCursor: boundary }, { revision: 1 });
  for (const rows of [[], [{ from: "me", at: 1201, id: "reply" }], [{ from: "peer", at: 1200, id: "m1200" }]]) {
    assert.equal(directMessageUnreadCount(rows, { accountId: "me", cursor: marker }), 1200);
  }
  assert.equal(directMessageUnreadCount([{ from: "peer", at: 1201, id: "m1201", server: true }], { accountId: "me", cursor: marker }), 1201);
  assert.equal(directMessageUnreadCount([{ from: "peer", at: 1201, id: "m1201", pending: true }], { accountId: "me", cursor: marker }), 1200);
});

test("older inbox/head snapshots cannot override newer counts or a confirmed read cursor", () => {
  const newer = mergeDirectMessageReadSummary(null, { readCursor: null, unread: 1200, latestIncomingCursor: { createdAt: 1200, id: "m1200" } }, { revision: 3 });
  const stale = mergeDirectMessageReadSummary(newer, { readCursor: null, unread: 1000, latestIncomingCursor: { createdAt: 1000, id: "m1000" } }, { revision: 2 });
  assert.deepEqual(stale, newer);
  // A read executes after the snapshot and advances the cursor even if its
  // request began earlier. Its returned full-history count is authoritative.
  const read = mergeDirectMessageReadSummary(newer, { readCursor: { createdAt: 1000, id: "m1000" }, unread: 200, latestIncomingCursor: { createdAt: 1200, id: "m1200" } }, { revision: 1 });
  assert.equal(read.unread, 200);
  assert.equal(read.id, "m1000");
  assert.equal(read.summaryRevision, 3);
  const raced = mergeDirectMessageReadSummary(read, { readCursor: null, unread: 1200, latestIncomingCursor: { createdAt: 1200, id: "m1200" } }, { revision: 4 });
  assert.deepEqual(raced, read, "GET snapshot before confirmed read cannot resurrect unread");
});

test("a fresh deletion snapshot may reduce the boundary and total without losing later cached arrivals", () => {
  const first = mergeDirectMessageReadSummary(null, { readCursor: null, unread: 3, latestIncomingCursor: { createdAt: 3, id: "c" } }, { revision: 1 });
  const removed = mergeDirectMessageReadSummary(first, { readCursor: null, unread: 2, latestIncomingCursor: { createdAt: 2, id: "b" } }, { revision: 2 });
  assert.equal(directMessageUnreadCount([{ from: "peer", at: 4, id: "d" }], { accountId: "me", cursor: removed }), 3);
  const empty = mergeDirectMessageReadSummary(removed, { readCursor: null, unread: 0, latestIncomingCursor: null }, { revision: 3 });
  assert.equal(directMessageUnreadCount([], { accountId: "me", cursor: empty }), 0);
});

test("malformed totals and an unversioned bare cursor cannot retain an incorrect complete count", () => {
  const marker = mergeDirectMessageReadSummary(null, { readCursor: null, unread: 20, latestIncomingCursor: { createdAt: 20, id: "z" } });
  const malformed = mergeDirectMessageReadSummary(marker, { unread: -1, latestIncomingCursor: null });
  assert.deepEqual(malformed, marker);
  const advanced = mergeDirectMessageReadSummary(marker, { readCursor: { createdAt: 10, id: "k" } });
  assert.equal(advanced.unread, undefined);
  assert.equal(directMessageUnreadCount([{ from: "peer", at: 20, id: "z" }], { accountId: "me", cursor: advanced }), 1);
});

test("a lowered deletion boundary never adds back stale rows beyond the removal response cap", () => {
  const rows = [1, 2, 3].map(at => ({ id: `m${at}`, at, from: "peer", server: true }));
  const first = mergeDirectMessageReadSummary(null, { readCursor: null, unread: 3, latestIncomingCursor: { createdAt: 3, id: "m3" } }, { revision: 1 });
  const removedLatest = mergeDirectMessageReadSummary(first, { readCursor: null, unread: 2, latestIncomingCursor: { createdAt: 2, id: "m2" } }, { revision: 2 });
  assert.equal(directMessageUnreadCount(rows, { accountId: "me", cursor: removedLatest }), 2,
    "m3 may remain cached when a bounded removal response omits its tombstone");
  assert.equal(removedLatest.latestIncomingCursor.id, "m2");
  assert.equal(removedLatest.unreadCoverageCursor.id, "m3");
  const newArrival = { id: "m4", at: 4, from: "peer", server: true };
  assert.equal(directMessageUnreadCount([...rows, newArrival], { accountId: "me", cursor: removedLatest }), 3);
  const removedAll = mergeDirectMessageReadSummary(removedLatest, { readCursor: null, unread: 0, latestIncomingCursor: null }, { revision: 3 });
  assert.equal(directMessageUnreadCount(rows, { accountId: "me", cursor: removedAll }), 0);
  assert.equal(directMessageUnreadCount([...rows, newArrival], { accountId: "me", cursor: removedAll }), 1);
});
