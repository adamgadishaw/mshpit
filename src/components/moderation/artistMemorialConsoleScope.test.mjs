import assert from "node:assert/strict";
import test from "node:test";

import {
  artistMemorialConsoleOperationOwned,
  artistMemorialConsoleOwnsScope,
} from "./artistMemorialConsoleScope.mjs";

test("memorial drafts and save completions are owned by one exact staff session", () => {
  assert.equal(artistMemorialConsoleOwnsScope("admin-a\0admin", "admin-a\0admin"), true);
  assert.equal(artistMemorialConsoleOwnsScope("admin-a\0admin", "admin-b\0admin"), false);
  assert.equal(artistMemorialConsoleOwnsScope("admin-a\0admin", "admin-a\0moderator"), false);
  assert.equal(artistMemorialConsoleOwnsScope(null, null), false);
  assert.equal(artistMemorialConsoleOperationOwned({
    operationScope: "admin-a\0admin",
    operationId: 4,
    currentScope: "admin-a\0admin",
    currentOperationId: 4,
  }), true);
  assert.equal(artistMemorialConsoleOperationOwned({
    operationScope: "admin-a\0admin",
    operationId: 4,
    currentScope: "admin-b\0admin",
    currentOperationId: 4,
  }), false);
});
