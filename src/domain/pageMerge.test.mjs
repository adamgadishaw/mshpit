import assert from "node:assert/strict";
import test from "node:test";

import {
  memberMatchesDirectory,
  mergeUniquePage,
  reconcileMemberMutationPage,
} from "./pageMerge.mjs";

test("cursor pages append in order and deduplicate boundary rows", () => {
  assert.deepEqual(mergeUniquePage(
    [{ id: "new" }, { id: "boundary", value: "old" }],
    [{ id: "boundary", value: "fresh" }, { id: "older" }],
  ), [
    { id: "new" },
    { id: "boundary", value: "fresh" },
    { id: "older" },
  ]);
});

test("malformed rows never enter a private paged collection", () => {
  assert.deepEqual(mergeUniquePage([{ id: "ok" }], [null, {}, { id: "" }, { id: "next" }]), [
    { id: "ok" }, { id: "next" },
  ]);
});

test("member directory matching mirrors server name handle id role and status filters", () => {
  const member = {
    id: "user_123",
    name: "Mara Quinn",
    handle: "maraq",
    role: "fan",
    isBanned: false,
    suspendedUntil: null,
  };
  assert.equal(memberMatchesDirectory(member, { query: "MARA", role: "fan", status: "active" }, { now: 100 }), true);
  assert.equal(memberMatchesDirectory(member, { query: "Toronto" }, { now: 100 }), false);
  assert.equal(memberMatchesDirectory({ ...member, isBanned: true }, { status: "active" }, { now: 100 }), false);
  assert.equal(memberMatchesDirectory({ ...member, suspendedUntil: 200 }, { status: "suspended" }, { now: 100 }), true);
});

test("member mutation removes a row that leaves the active server scope and decrements its total", () => {
  const result = reconcileMemberMutationPage(
    [
      { id: "newer", role: "fan", isBanned: false },
      { id: "target", role: "fan", isBanned: false },
    ],
    { query: "", role: "fan", status: "active", matchingTotal: 12, nextCursor: "older" },
    "target",
    { isBanned: true },
    { now: 100 },
  );
  assert.deepEqual(result.members, [{ id: "newer", role: "fan", isBanned: false }]);
  assert.equal(result.directory.matchingTotal, 11);
  assert.equal(result.directory.nextCursor, "older");
});

test("member mutation keeps and patches a row that remains in scope", () => {
  const directory = { query: "target", role: "", status: "", matchingTotal: 1, nextCursor: null };
  const result = reconcileMemberMutationPage(
    [{ id: "target", name: "Target Member", role: "fan", verified: false }],
    directory,
    "target",
    { verified: true },
  );
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0].verified, true);
  assert.equal(result.directory, directory);
});
