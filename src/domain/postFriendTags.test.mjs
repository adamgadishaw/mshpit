import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_POST_TAGGED_PEOPLE,
  normalizeTaggedPeople,
  normalizeTaggedUserIds,
  taggedUserIdsFromPeople,
} from "./postFriendTags.mjs";

test("tagged account ids are ordered, trimmed, deduplicated, and bounded", () => {
  assert.deepEqual(normalizeTaggedUserIds([" friend_b ", "friend_a", "friend_b"]), ["friend_b", "friend_a"]);
  assert.deepEqual(normalizeTaggedUserIds(null), []);
  assert.equal(normalizeTaggedUserIds(Array.from({ length: MAX_POST_TAGGED_PEOPLE + 1 }, (_, index) => `u_${index}`)), null);
});

test("malformed structured tagging fails closed instead of becoming descriptive tags", () => {
  for (const value of ["u_1", {}, [""], ["two words"], ["u_1\nforged"], [7]]) {
    assert.equal(normalizeTaggedUserIds(value), null);
  }
});

test("public person snapshots retain only bounded display fields and derive ids", () => {
  const people = normalizeTaggedPeople([
    { id: " u_2 ", name: " Bea ", handle: "bea", initials: "B", verified: true, email: "private@example.com" },
    { id: "u_2", name: "Duplicate" },
    { id: "u_3", name: "Cara", handle: "cara", role: "artist" },
  ]);
  assert.deepEqual(people.map(({ id, name, handle }) => ({ id, name, handle })), [
    { id: "u_2", name: "Bea", handle: "bea" },
    { id: "u_3", name: "Cara", handle: "cara" },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(people[0], "email"), false);
  assert.deepEqual(taggedUserIdsFromPeople(people), ["u_2", "u_3"]);
});
