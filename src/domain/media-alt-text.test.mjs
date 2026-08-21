import assert from "node:assert/strict";
import test from "node:test";

import { mediaAltTextCompletion, mediaAltTextGuidance, mediaAltTextState } from "./media-alt-text.mjs";

test("completion counts only current non-decorative photos and never blocks legacy media", () => {
  const completion = mediaAltTextCompletion([
    { id: "local:1", kind: "image", altText: "Singer on stage" },
    { id: "local:2", kind: "image", altText: "   " },
    { id: "legacy:1", kind: "image", altText: "" },
    { id: "local:3", kind: "image", decorative: true, altText: "" },
    { id: "clip:1", kind: "video", altText: "" },
  ]);
  assert.deepEqual(completion, {
    photos: 4,
    tracked: 2,
    completed: 1,
    missing: 1,
    optional: 2,
    progress: 0.5,
    label: "1 of 2 photos described",
  });
});

test("alt-text state treats whitespace as missing and explicit opt-outs as optional", () => {
  assert.equal(mediaAltTextState({ id: "local:1", kind: "image", altText: "  " }), "missing");
  assert.equal(mediaAltTextState({ id: "local:2", kind: "image", altText: "Crowd at sunset" }), "complete");
  assert.equal(mediaAltTextState({ id: "local:3", kind: "image", altTextRequired: false }), "optional");
  assert.equal(mediaAltTextState({ id: "video:1", kind: "video" }), "ignored");
});

test("guidance is contextual, human-written, and identifies each photo", () => {
  const portrait = mediaAltTextGuidance({ id: "local:1", kind: "image", width: 800, height: 1_400 }, { photoIndex: 1, photoCount: 4 });
  assert.equal(portrait.position, "Photo 2 of 4");
  assert.match(portrait.reminder, /human-written/);
  assert.match(portrait.guidance, /main person or action/);

  const landscape = mediaAltTextGuidance({ id: "local:2", kind: "image", width: 1_600, height: 900, altText: "A band performs" });
  assert.match(landscape.reminder, /Description added/);
  assert.match(landscape.guidance, /overall scene/);

  const legacy = mediaAltTextGuidance({ id: "legacy:1", kind: "image" }, { photoIndex: 0, photoCount: 1 });
  assert.match(legacy.reminder, /optional/);
});
