import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteAccountDraft,
  draftsForAccount,
  migrateLegacyDrafts,
  QUARANTINED_LEGACY_DRAFT_OWNER,
  resolveQuarantinedLegacyDrafts,
  upsertAccountDraft,
} from "./draftPolicy.mjs";

test("an ownerless legacy draft is recovered by the persisted account", () => {
  const migrated = migrateLegacyDrafts([{ id: "old", review: "private" }], "u_adam");
  assert.deepEqual(migrated, [{ id: "old", review: "private", ownerId: "u_adam" }]);
  assert.equal(draftsForAccount(migrated, "u_adam").length, 1);
  assert.deepEqual(draftsForAccount(migrated, "u_other"), []);
});

test("ownerless legacy drafts stay quarantined while production identity is locked", () => {
  const migrated = migrateLegacyDrafts([{ id: "old", review: "private", photos: ["private.jpg"] }], null);
  assert.equal(migrated[0].ownerId, QUARANTINED_LEGACY_DRAFT_OWNER);
  assert.deepEqual(draftsForAccount(migrated, null), []);
  assert.deepEqual(draftsForAccount(migrated, "u_other"), []);
});

test("a quarantined draft is claimed only by the matching authoritative legacy account", () => {
  const quarantined = migrateLegacyDrafts([{ id: "old", review: "private" }], null);
  const restored = resolveQuarantinedLegacyDrafts(quarantined, "u_adam", "u_adam");
  assert.deepEqual(draftsForAccount(restored, "u_adam").map((draft) => draft.id), ["old"]);

  const rejected = resolveQuarantinedLegacyDrafts(quarantined, "u_other", "u_adam");
  assert.deepEqual(rejected, []);
});

test("draft reads, updates, and deletes cannot cross account boundaries", () => {
  const initial = [
    { id: "a", ownerId: "u_a", review: "A" },
    { id: "b", ownerId: "u_b", review: "B" },
  ];
  assert.deepEqual(draftsForAccount(initial, "u_a").map((draft) => draft.id), ["a"]);

  const updated = upsertAccountDraft(initial, { id: "a", review: "A2" }, "u_a");
  assert.equal(draftsForAccount(updated, "u_a")[0].review, "A2");
  assert.equal(draftsForAccount(updated, "u_b")[0].review, "B");

  const attemptedCrossDelete = deleteAccountDraft(updated, "b", "u_a");
  assert.equal(draftsForAccount(attemptedCrossDelete, "u_b").length, 1);
});

test("draft updates preserve posting identity and photo-gallery consent", () => {
  const updated = upsertAccountDraft([], {
    id: "draft",
    submissionId: "post_retry_identity",
    photosPublic: false,
  }, "u_a");
  assert.equal(updated[0].submissionId, "post_retry_identity");
  assert.equal(updated[0].photosPublic, false);
});
