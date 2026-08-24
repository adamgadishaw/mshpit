import assert from "node:assert/strict";
import test from "node:test";
import { profileHistoryFromResponse, profileHistoryRequest } from "./profileHistoryRequest.mjs";

test("profile history requests bind the viewer, target, page size, and opaque cursor", () => {
  assert.deepEqual(profileHistoryRequest({ accountId: "viewer", targetId: "target", before: "opaque+/=" }), {
    path: "/api/users/target/posts?limit=30&before=opaque%2B%2F%3D",
    expectedAccountId: "viewer",
  });
  assert.throws(() => profileHistoryRequest({ targetId: "" }), TypeError);
});

test("profile history responses fail closed instead of converting malformed data to an empty complete wall", () => {
  const valid = { posts: [{ id: "p1" }], nextCursor: null };
  assert.deepEqual(profileHistoryFromResponse(valid), valid);
  for (const malformed of [
    null,
    {},
    { posts: null, nextCursor: null },
    { posts: [] },
    { posts: [], nextCursor: "" },
    { posts: [], nextCursor: 4 },
  ]) assert.throws(() => profileHistoryFromResponse(malformed), TypeError);
});
