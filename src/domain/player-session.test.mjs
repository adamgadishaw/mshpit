import test from "node:test";
import assert from "node:assert/strict";
import {
  ownedPlayerEnvelope,
  ownedPlayerPositionEnvelope,
  restoreOwnedPlayerPosition,
  restoreOwnedPlayerState,
} from "./player-session.mjs";

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

test("playback position is bounded and restored only for its account owner", () => {
  const stored = ownedPlayerPositionEnvelope("account-a", "deezer:123", 42_500);
  assert.deepEqual(stored, { ownerId: "account-a", position: { key: "deezer:123", ms: 42_500 } });
  assert.deepEqual(restoreOwnedPlayerPosition(stored, "account-a"), { key: "deezer:123", ms: 42_500 });
  assert.equal(restoreOwnedPlayerPosition(stored, "account-b"), null);
  assert.equal(ownedPlayerPositionEnvelope(null, "deezer:123", 42_500), null);
  assert.equal(ownedPlayerPositionEnvelope("account-a", "deezer:123", 0), null);
});
