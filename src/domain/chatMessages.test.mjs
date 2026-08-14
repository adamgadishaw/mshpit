import assert from "node:assert/strict";
import test from "node:test";

import { mergeChatMessages, reconcileRemovedDirectMessages } from "./chatMessages.mjs";

test("DM reconciliation removes server tombstones before merging new rows", () => {
  assert.deepEqual(mergeChatMessages(
    [{ id: "dm_removed", text: "must disappear", at: 1 }, { id: "dm_live", text: "old", at: 2 }],
    [{ id: "dm_live", text: "authoritative", at: 2 }, { id: "dm_new", text: "new", at: 3 }],
    ["dm_removed"],
  ), [
    { id: "dm_live", text: "authoritative", at: 2 },
    { id: "dm_new", text: "new", at: 3 },
  ]);
});

test("DM tombstones clear only the active account's matching cached threads", () => {
  const original = {
    "u_me__u_other": [{ id: "dm_removed", at: 1 }],
    "u_else__u_other": [{ id: "dm_removed", at: 1 }],
    "u_me__u_live": [{ id: "dm_live", at: 2 }],
  };
  assert.deepEqual(reconcileRemovedDirectMessages(original, "u_me", ["dm_removed"]), {
    "u_else__u_other": [{ id: "dm_removed", at: 1 }],
    "u_me__u_live": [{ id: "dm_live", at: 2 }],
  });
  assert.deepEqual(original["u_me__u_other"], [{ id: "dm_removed", at: 1 }], "the helper stays immutable");
});
