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
