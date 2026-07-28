import test from "node:test";
import assert from "node:assert/strict";

import { deleteAccountDraft, draftsForAccount, migrateLegacyDrafts, upsertAccountDraft } from "./draftPolicy.mjs";

test("legacy drafts are assigned once to the currently restored account", () => {
  assert.deepEqual(migrateLegacyDrafts([{ id: "old" }], "u_adam"), [{ id: "old", ownerId: "u_adam" }]);
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
