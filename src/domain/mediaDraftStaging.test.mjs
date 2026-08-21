import test from "node:test";
import assert from "node:assert/strict";

import {
  isPersistableMediaDraftUri,
  mediaDraftFileName,
  safeMediaDraftSegment,
} from "./mediaDraftStaging.mjs";

test("native Studio draft names stay bounded and path-safe", () => {
  assert.equal(safeMediaDraftSegment(" u/member:one "), "u-member-one");
  assert.equal(mediaDraftFileName({ id: "local:one", fileName: "IMG 42.HEIC", kind: "image" }, 2), "03-local-one.heic");
  assert.equal(mediaDraftFileName({ id: "clip", kind: "video" }, 0), "01-clip.mp4");
});

test("only file URIs inside a PIT Studio staging segment can enter drafts", () => {
  assert.equal(isPersistableMediaDraftUri("file:///data/user/0/com.mshpit.app/files/pit-studio/u/post/01.jpg"), true);
  assert.equal(isPersistableMediaDraftUri("file:///var/mobile/PIT-STUDIO/u/post/01.mp4"), true);
  assert.equal(isPersistableMediaDraftUri("file:///var/mobile/Documents/private.jpg"), false);
  assert.equal(isPersistableMediaDraftUri("https://media.example/pit-studio/u/post/01.jpg"), false);
  assert.equal(isPersistableMediaDraftUri("file:///var/mobile/pit-studio/u/../private.jpg"), false);
  assert.equal(isPersistableMediaDraftUri("file:///var/mobile/pit-studio/u/%2e%2e/private.jpg"), false);
  assert.equal(isPersistableMediaDraftUri("file:///var/mobile/pit-studio/u/01.jpg?token=x"), false);
});
