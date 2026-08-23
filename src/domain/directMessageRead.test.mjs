import assert from "node:assert/strict";
import test from "node:test";
import {
  directMessageIsAfterCursor,
  directMessageUnreadCount,
  latestDirectMessageReadCursor,
  normalizeDirectMessageReadCursor,
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
