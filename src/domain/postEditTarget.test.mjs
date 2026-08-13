import assert from "node:assert/strict";
import test from "node:test";

import { mergeEditedPost, resolvePostEditTarget } from "./postEditTarget.mjs";

test("directly resolved posts remain authoritative edit targets before entering the feed", () => {
  const resolved = { id: "status_1", userId: "u_me", version: 42, kind: "status" };
  assert.equal(resolvePostEditTarget([], resolved), resolved);
});

test("fresh feed state wins over an older navigation snapshot", () => {
  const snapshot = { id: "status_1", version: 41 };
  const live = { id: "status_1", version: 42 };
  assert.equal(resolvePostEditTarget([live], snapshot), live);
});

test("a successful direct-link edit becomes the authoritative feed object", () => {
  const other = { id: "status_2", version: 1 };
  const updated = { id: "status_1", version: 43, review: "updated" };
  assert.deepEqual(mergeEditedPost([other], updated), [updated, other]);
  assert.deepEqual(mergeEditedPost([{ id: "status_1", version: 42 }, other], updated), [updated, other]);
});
