import assert from "node:assert/strict";
import test from "node:test";

import { convertingClipSummary } from "./convertingClips.mjs";

test("the author is told plainly what is happening to their clips", () => {
  assert.equal(convertingClipSummary({}), "");
  assert.equal(convertingClipSummary({ converting: 1 }),
    "Your clip is still converting. It shows up on this post by itself when it's ready.");
  assert.match(convertingClipSummary({ converting: 2 }), /^2 clips are still converting\./);
  assert.equal(convertingClipSummary({ failed: 1 }), "One clip couldn't be converted.");
  assert.match(convertingClipSummary({ converting: 1, failed: 2 }), /still converting.*2 clips couldn't be converted\.$/);
  for (const text of [convertingClipSummary({ converting: 3, failed: 1 }), convertingClipSummary({ converting: 1 })]) {
    assert.equal(text.includes("—"), false, "no em dashes in member copy");
  }
});
