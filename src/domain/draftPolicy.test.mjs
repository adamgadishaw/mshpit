import test from "node:test";
import assert from "node:assert/strict";

import { deleteAccountDraft, draftsForAccount, migrateLegacyDrafts, upsertAccountDraft } from "./draftPolicy.mjs";

test("an ownerless legacy draft is recovered by the persisted account", () => {
  const migrated = migrateLegacyDrafts([{ id: "old", review: "private" }], "u_adam");
  assert.deepEqual(migrated, [{ id: "old", review: "private", ownerId: "u_adam" }]);
  assert.equal(draftsForAccount(migrated, "u_adam").length, 1);
  assert.deepEqual(draftsForAccount(migrated, "u_other"), []);
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
