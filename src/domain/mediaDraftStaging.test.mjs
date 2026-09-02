import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isPersistableMediaDraftUri,
  MEDIA_DRAFT_CACHE_RETENTION_MS,
  mediaDraftDirectoryIsStale,
  mediaDraftFileName,
  safeMediaDraftSegment,
} from "./mediaDraftStaging.mjs";

test("native Studio draft names stay bounded and path-safe", () => {
  assert.equal(safeMediaDraftSegment(" u/member:one "), "u-member-one");
  assert.equal(safeMediaDraftSegment("."), "item");
  assert.equal(safeMediaDraftSegment(".."), "item");
  assert.equal(safeMediaDraftSegment("...", ""), "");
  assert.equal(safeMediaDraftSegment("../owner"), "owner");
  assert.equal(mediaDraftFileName({ id: "local:one", fileName: "IMG 42.HEIC", kind: "image" }, 2), "03-local-one.heic");
  assert.equal(mediaDraftFileName({
    id: "converted",
    uri: "file:///cache/picker-output.jpg",
    fileName: "IMG 42.HEIC",
    mimeType: "image/heic",
    kind: "image",
  }, 0), "01-converted.jpg");
  assert.equal(mediaDraftFileName({
    id: "sniffed",
    uri: "file:///cache/no-extension",
    fileName: "IMG 42.HEIC",
    mimeType: "image/heic",
    kind: "image",
  }, 0, { detectedMimeType: "image/jpeg" }), "01-sniffed.jpg");
  assert.equal(mediaDraftFileName({ id: "clip", kind: "video" }, 0), "01-clip.mp4");
});

test("native media staging uses cache and safely ages legacy document drafts after seven days", () => {
  const source = readFileSync(new URL("../lib/mediaDraftStaging.native.js", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  assert.match(source, /new Directory\(Paths\.cache, STUDIO_ROOT_NAME/);
  assert.match(source, /new Directory\(Paths\.document, STUDIO_ROOT_NAME/);
  assert.match(source, /managedKind === "legacy-document"/);
  assert.match(source, /for \(const root of studioRoots\(\)\)/);
  assert.match(source, /new Directory\(root, owner\)/,
    "account deletion removes current cache and legacy document roots for only that owner");
  assert.doesNotMatch(source, /Paths\.(?:cache|document)\.delete/,
    "cleanup never targets a broad Expo filesystem root");
  assert.match(storeSource, /pruneStaleMediaDraftAssets\(\)/,
    "native startup invokes draft aging even when no saved composer draft is opened");
  const now = 20 * 24 * 60 * 60_000;
  assert.equal(MEDIA_DRAFT_CACHE_RETENTION_MS, 7 * 24 * 60 * 60_000);
  assert.equal(mediaDraftDirectoryIsStale({ modificationTime: now - MEDIA_DRAFT_CACHE_RETENTION_MS }, { at: now }), true);
  assert.equal(mediaDraftDirectoryIsStale({ modificationTime: now - MEDIA_DRAFT_CACHE_RETENTION_MS + 1 }, { at: now }), false);
  assert.equal(mediaDraftDirectoryIsStale({}, { at: now }), false, "unknown filesystem dates are retained safely");
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
