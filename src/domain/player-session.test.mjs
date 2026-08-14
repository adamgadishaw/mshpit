import test from "node:test";
import assert from "node:assert/strict";
import { ownedPlayerEnvelope, restoreOwnedPlayerState } from "./player-session.mjs";

test("restoreOwnedPlayerState only restores the exact account owner's queue", () => {
  const queue = { list: [{ title: "Middle Child", artist: "J. Cole" }], index: 0 };
  const stored = ownedPlayerEnvelope("account-a", queue);

  assert.deepEqual(restoreOwnedPlayerState(stored, "account-a"), queue);
  assert.equal(restoreOwnedPlayerState(stored, "account-b"), null);
  assert.equal(restoreOwnedPlayerState(stored, null), null);
});

test("ownedPlayerEnvelope keeps a stopped session scoped to its account", () => {
  assert.deepEqual(ownedPlayerEnvelope("account-a", null), { ownerId: "account-a", state: null });
  assert.equal(restoreOwnedPlayerState(ownedPlayerEnvelope("account-a", null), "account-a"), null);
  assert.equal(ownedPlayerEnvelope(null, { list: [] }), null);
});
