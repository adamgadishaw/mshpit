import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  directMessageIsAfterCursor,
  directMessageUnreadCount,
  latestDirectMessageReadCursor,
  latestIncomingDirectMessageId,
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

test("ThreadScreen owns read writes by inbound identity rather than total message count", () => {
  const source = readFileSync(new URL("../screens/ThreadScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /const incomingReadTarget = latestIncomingDirectMessageId\(messages, session\?\.id\)/);
  assert.match(source, /\}, \[incomingReadTarget, otherId, session\?\.id\]\);/);
  assert.doesNotMatch(source, /markThreadRead\(otherId\); \}, \[otherId, messages\.length\]/);
});
