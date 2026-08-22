import test from "node:test";
import assert from "node:assert/strict";
import { playerResolutionKey } from "./trackIdentity.mjs";
import {
  ownedPlayerEnvelope,
  ownedPlayerPositionEnvelope,
  playerQueueWithEntryIds,
  restoreOwnedPlayerPosition,
  restoreOwnedPlayerState,
} from "./player-session.mjs";

test("restoreOwnedPlayerState only restores the exact account owner's queue", () => {
  const queue = { list: [{ title: "Middle Child", artist: "J. Cole" }], index: 0 };
  const stored = ownedPlayerEnvelope("account-a", queue);

  const restored = restoreOwnedPlayerState(stored, "account-a");
  assert.equal(restored.index, 0);
  assert.equal(restored.list[0].title, "Middle Child");
  assert.match(restored.list[0].queueEntryId, /^queue_/);
  assert.equal(restoreOwnedPlayerState(stored, "account-b"), null);
  assert.equal(restoreOwnedPlayerState(stored, null), null);
});

test("queue occurrence IDs distinguish duplicates and survive earlier-row edits", () => {
  let sequence = 0;
  const same = { title: "Repeat", artist: "Artist", sourceId: "42", provider: "deezer" };
  const entries = playerQueueWithEntryIds(
    [{ title: "Earlier", artist: "Artist" }, same, same],
    { createId: () => `occurrence-${++sequence}` },
  );
  assert.notEqual(entries[1].queueEntryId, entries[2].queueEntryId, "duplicate recordings are separate occurrences");
  const currentId = entries[2].queueEntryId;
  const currentMediaKey = playerResolutionKey({ track: entries[2], user: { id: "account-a", emailVerified: true } });
  const afterRemovingEarlier = entries.slice(1);
  const afterMovingEarlier = [entries[1], entries[0], entries[2]];
  assert.equal(afterRemovingEarlier[1].queueEntryId, currentId, "removing a preceding row does not restart current playback");
  assert.equal(afterMovingEarlier[2].queueEntryId, currentId, "moving a preceding row does not restart current playback");
  assert.equal(
    playerResolutionKey({ track: afterRemovingEarlier[1], user: { id: "account-a", emailVerified: true } }),
    currentMediaKey,
    "removing a preceding row leaves the current media generation uninterrupted",
  );
  assert.equal(
    playerResolutionKey({ track: afterMovingEarlier[2], user: { id: "account-a", emailVerified: true } }),
    currentMediaKey,
    "moving a preceding row leaves the current media generation uninterrupted",
  );

  const restored = playerQueueWithEntryIds(entries, { preserveExisting: true });
  assert.deepEqual(restored.map((entry) => entry.queueEntryId), entries.map((entry) => entry.queueEntryId));
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
