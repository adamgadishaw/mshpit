import assert from "node:assert/strict";
import test from "node:test";
import {
  isMirroredVenuePhoto,
  isStructurallyMirroredVenuePhoto,
  pendingVenueMirrorCount,
  selectVenuePhotoMirrorBatch,
} from "./venue-photo-mirror-batch.mjs";

const photo = (overrides = {}) => ({
  uri: "https://upload.wikimedia.org/example.jpg",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Example.jpg",
  creator: "Venue Photographer",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  source: "commons",
  ...overrides,
});

test("mirror batches are stable, bounded, and resumable", () => {
  const entries = [
    ["zulu", { galleryPool: [photo()] }],
    ["empty", { galleryPool: [] }],
    ["alpha", { galleryPool: [photo()] }],
  ];
  const first = selectVenuePhotoMirrorBatch(entries, { limit: 1 });
  assert.deepEqual(first.selected.map(([key]) => key), ["alpha"]);
  assert.equal(first.hasMore, true);
  const resumed = selectVenuePhotoMirrorBatch(entries, { cursor: "alpha", all: true });
  assert.deepEqual(resumed.selected.map(([key]) => key), ["zulu"]);
  assert.throws(
    () => selectVenuePhotoMirrorBatch(entries, { cursor: "missing", all: true }),
    /Unknown venue-photo mirror cursor/u,
  );
});

test("only exact MSHpit storage records with a derivative notice count as mirrored", () => {
  const env = { MEDIA_PUBLIC_BASE_URL: "https://media.example/base" };
  const mirrored = photo({
    uri: "https://media.example/base/venues/licensed/history-a1b2c3d4e5f6/abcdef.webp",
    mirroredFrom: "https://upload.wikimedia.org/example.jpg",
    modificationNotice: "Converted to WebP and resized when needed by MSHpit for delivery.",
    mirror: {
      objectKey: "venues/licensed/history-a1b2c3d4e5f6/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef.webp",
      contentType: "image/webp",
      byteSize: 1024,
      sha256: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef1234567890abcdef",
      width: 1200,
      height: 800,
    },
  });
  mirrored.uri = "https://media.example/base/venues/licensed/history-a1b2c3d4e5f6/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef.webp";
  assert.equal(isStructurallyMirroredVenuePhoto(mirrored), true);
  assert.equal(isMirroredVenuePhoto(mirrored, env), true);
  assert.equal(pendingVenueMirrorCount({ galleryPool: [mirrored, photo()] }, env), 1);
  assert.equal(isMirroredVenuePhoto({
    ...mirrored,
    uri: "https://attacker.example/venues/licensed/history-a1b2c3d4e5f6/abcdef.webp",
  }, env), false);
  assert.equal(isMirroredVenuePhoto({ ...mirrored, modificationNotice: "Cropped." }, env), false);
  assert.equal(isStructurallyMirroredVenuePhoto({
    ...mirrored,
    mirror: { ...mirrored.mirror, sha256: "0".repeat(64) },
  }), false);
  assert.equal(isStructurallyMirroredVenuePhoto({
    ...mirrored,
    uri: `${mirrored.uri}?hotlink=1`,
  }), false);
});
