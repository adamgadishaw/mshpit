import assert from "node:assert/strict";
import test from "node:test";

import { pickerOwnerMatchesComposer, restoreComposerFrame } from "./composerRecovery.mjs";

test("native composer recovery restores its draft identity before pending media is delivered", () => {
  const restored = restoreComposerFrame(
    { logging: true, composerId: "composer_1" },
    { composerId: "composer_1", draftId: "draft_1", requestId: "picker_1" },
  );
  assert.equal(restored.draftId, "draft_1");
  assert.equal(pickerOwnerMatchesComposer({ composerId: "composer_1", requestId: "picker_1" }, restored), true);
});

test("pending picker ownership cannot cross composer identities", () => {
  const frame = restoreComposerFrame({ logging: true, composerId: "composer_new" }, null);
  assert.equal(pickerOwnerMatchesComposer({ composerId: "composer_old", requestId: "picker_1" }, frame), false);
  assert.equal(restoreComposerFrame({ profileId: "u_1" }, null), null);
});
