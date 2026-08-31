import test from "node:test";
import assert from "node:assert/strict";
import { resolvePostAuthor } from "./postAuthor.mjs";

test("fresh feed author media wins over a stale cached profile", () => {
  const author = resolvePostAuthor({
    userId: "u-1",
    cached: { id: "u-1", name: "Old name", avatarUri: null, role: "artist", badges: ["early"], profileUpdatedAt: 10 },
    embedded: { name: "New name", handle: "new", avatarUri: "https://media.test/avatar.jpg", avatarColor: "#abc", profileUpdatedAt: 20 },
  });
  assert.equal(author.avatarUri, "https://media.test/avatar.jpg");
  assert.equal(author.name, "New name");
  assert.equal(author.role, "artist");
  assert.deepEqual(author.badges, ["early"]);
});

test("an authoritative null embedded avatar clears an obsolete cached image", () => {
  const author = resolvePostAuthor({
    userId: "u-1",
    cached: { avatarUri: "https://media.test/old.jpg", profileUpdatedAt: 10 },
    embedded: { avatarUri: null, initials: "AB", profileUpdatedAt: 20 },
  });
  assert.equal(author.avatarUri, null);
  assert.equal(author.initials, "AB");
});

test("a profile opened after an old feed snapshot keeps the newer cached avatar", () => {
  const author = resolvePostAuthor({
    userId: "u-1",
    cached: { name: "Current", avatarUri: "https://media.test/current.jpg", profileUpdatedAt: 30 },
    embedded: { name: "Old", avatarUri: null, profileUpdatedAt: 20 },
  });
  assert.equal(author.name, "Current");
  assert.equal(author.avatarUri, "https://media.test/current.jpg");
  assert.equal(author.profileUpdatedAt, 30);
});
