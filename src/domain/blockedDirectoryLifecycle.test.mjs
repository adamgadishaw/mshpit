import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function find(node) {
  if (node?.type === "VariableDeclarator" && node.id?.name === "refreshBlockedDirectory") return node.init;
  if (!node || typeof node !== "object") return null;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const item of value) { const found = find(item); if (found) return found; } }
    else if (value && typeof value === "object") { const found = find(value); if (found) return found; }
  }
  return null;
}
const callback = find(ast); assert.ok(callback);
function fixture() {
  const pending = [], applied = [];
  const sessionRef = { current: { id: "a" } }, accountMutationEpochRef = { current: 1 };
  const blockedIdsRef = { current: [], accountId: "a", status: "ready" };
  const venuePhotoCacheRef = { current: { privacy: { revision: 1, blockGraphAuthoritative: true, pendingMutations: new Set() } } };
  const dependencies = {
    sessionRef, accountMutationEpochRef, blockedIdsRef, venuePhotoCacheRef,
    api: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    setBlockedIds: (next) => { if (typeof next !== "function") { blockedIdsRef.current = next; applied.push([...next]); } },
    setVenueReviews: () => {}, withoutVenueReviewsByUsers: (groups) => groups, absorbUsers: () => {},
    rotateVenuePhotoPrivacyScope: ({ blockGraphAuthoritative }) => {
      venuePhotoCacheRef.current.privacy.revision += 1;
      venuePhotoCacheRef.current.privacy.blockGraphAuthoritative = blockGraphAuthoritative;
    },
  };
  const refresh = new Function(...Object.keys(dependencies), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(dependencies));
  return { refresh, pending, applied, blockedIdsRef, sessionRef, accountMutationEpochRef, privacy: venuePhotoCacheRef.current.privacy };
}

test("an older blocked list cannot roll back a newer successful refresh", async () => {
  const f = fixture(), old = f.refresh(), fresh = f.refresh();
  f.pending[1].resolve({ users: [{ id: "newly-blocked" }] }); await fresh;
  f.pending[0].resolve({ users: [] }); assert.equal((await old).stale, true);
  assert.deepEqual(f.blockedIdsRef.current, ["newly-blocked"]);
  assert.equal(f.blockedIdsRef.status, "ready");
  assert.deepEqual(f.applied, [["newly-blocked"]]);
});

test("account round trip cannot restore the abandoned blocked snapshot", async () => {
  const f = fixture(), old = f.refresh();
  f.sessionRef.current = { id: "b" }; f.accountMutationEpochRef.current += 1;
  f.sessionRef.current = { id: "a" }; f.accountMutationEpochRef.current += 1;
  f.pending[0].resolve({ users: [{ id: "stale-person" }] });
  assert.equal((await old).stale, true); assert.deepEqual(f.applied, []);
});

test("an old failure cannot replace a newer successful status", async () => {
  const f = fixture(), old = f.refresh(), fresh = f.refresh();
  f.pending[1].resolve({ users: [] }); await fresh;
  f.pending[0].reject(new Error("Old request failed"));
  assert.equal((await old).stale, true); assert.equal(f.blockedIdsRef.status, "ready");
});

for (const settled of [false, true]) {
  test(`a ${settled ? "completed" : "pending"} block mutation cannot be overwritten by an older refresh`, async () => {
    const f = fixture(), old = f.refresh();
    f.blockedIdsRef.current = ["newly-blocked"];
    f.privacy.revision += 1;
    if (!settled) f.privacy.pendingMutations.add("newly-blocked");
    f.pending[0].resolve({ users: [] });
    assert.equal((await old).stale, true);
    assert.deepEqual(f.blockedIdsRef.current, ["newly-blocked"]);
    assert.equal(f.blockedIdsRef.status, "error", "A superseded read must offer retry, not stay loading");
    assert.deepEqual(f.applied, []);
  });
}

test("an explicit obsolete owner cannot change current-directory loading state", async () => {
  const f = fixture(); assert.equal((await f.refresh({ accountId: "b" })).stale, true);
  assert.equal(f.pending.length, 0); assert.equal(f.blockedIdsRef.status, "ready");
});
