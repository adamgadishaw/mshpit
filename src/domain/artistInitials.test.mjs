import assert from "node:assert/strict";
import test from "node:test";

import { artistInitials } from "./artistInitials.mjs";

test("artist initials match between the hero, the avatar and the picker", () => {
  assert.equal(artistInitials("Little River Band"), "LR");
  assert.equal(artistInitials("Drake"), "DR");
  assert.equal(artistInitials("The Weeknd"), "WE");
  assert.equal(artistInitials("The"), "TH");
  assert.equal(artistInitials("  björk  "), "BJ");
  assert.equal(artistInitials("", "A"), "A");
  assert.equal(artistInitials(null), "?");
});
