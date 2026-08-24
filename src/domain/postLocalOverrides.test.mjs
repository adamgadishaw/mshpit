import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPostLocalOverride,
  postLocalOverrideKey,
  withRemovedSelfPostTag,
} from "./postLocalOverrides.mjs";

test("post tag removal overrides are account-scoped and remove only the current recipient", () => {
  const post = {
    id: "post-1",
    version: 10,
    taggedPeople: [
      { id: "me", name: "Me", handle: "me" },
      { id: "friend", name: "Friend", handle: "friend" },
    ],
  };
  const overrides = withRemovedSelfPostTag({}, {
    accountId: "me",
    postId: post.id,
    userId: "me",
    version: 25,
  });

  assert.equal(postLocalOverrideKey("me", post.id), "me:post-1");
  assert.deepEqual(applyPostLocalOverride(post, overrides, "me").taggedPeople.map((person) => person.id), ["friend"]);
  assert.equal(applyPostLocalOverride(post, overrides, "me").version, 25);
  assert.equal(applyPostLocalOverride(post, overrides, "another"), post);
  assert.deepEqual(post.taggedPeople.map((person) => person.id), ["me", "friend"], "source post stays immutable");
});

test("post tag removal overrides compose without hiding later co-tags", () => {
  let overrides = withRemovedSelfPostTag({}, { accountId: "me", postId: "post-2", userId: "me" });
  overrides = withRemovedSelfPostTag(overrides, { accountId: "me", postId: "post-2", userId: "me", version: 30 });
  const refreshed = {
    id: "post-2",
    version: 40,
    taggedPeople: [
      { id: "me", name: "Me" },
      { id: "new-friend", name: "New Friend" },
    ],
  };
  const resolved = applyPostLocalOverride(refreshed, overrides, "me");
  assert.deepEqual(resolved.taggedPeople.map((person) => person.id), ["new-friend"]);
  assert.equal(resolved.version, 40, "a newer canonical post version must win over the local removal receipt");
});
