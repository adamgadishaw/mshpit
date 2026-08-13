import assert from "node:assert/strict";
import test from "node:test";

import { inlineCommentPreview } from "./commentPreview.mjs";

test("canonical feed previews do not resurrect stale local comments", () => {
  const local = [
    { id: "deleted_elsewhere", userId: "u_1", text: "stale", at: 1 },
    { id: "pending", userId: "me", text: "sending", at: 3, pending: true },
  ];
  const preview = [{ id: "canonical", userId: "u_2", text: "current", createdAt: 2 }];
  assert.deepEqual(inlineCommentPreview(preview, local).map((comment) => comment.id), ["canonical", "pending"]);
});

test("blocking filters both canonical and pending comments immediately", () => {
  const blocked = (id) => id === "u_blocked";
  const rows = inlineCommentPreview(
    [{ id: "blocked_server", userId: "u_blocked", createdAt: 1 }, { id: "ok", userId: "u_ok", createdAt: 2 }],
    [{ id: "blocked_pending", userId: "u_blocked", at: 3, pending: true }],
    { isBlocked: blocked },
  );
  assert.deepEqual(rows.map((comment) => comment.id), ["ok"]);
});

test("legacy posts without a canonical preview retain their local cache", () => {
  assert.deepEqual(inlineCommentPreview(undefined, [{ id: "legacy", userId: "u_1" }]).map((comment) => comment.id), ["legacy"]);
});
