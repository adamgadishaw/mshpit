import assert from "node:assert/strict";
import test from "node:test";
import {
  QUARANTINED_SOURCE_PAGES,
  quarantineInvalidVenuePhotos,
} from "./quarantine-invalid-venue-photos.mjs";

test("the audited false matches are removed without blocking a future legitimate venue photo", () => {
  const [bad] = QUARANTINED_SOURCE_PAGES;
  const good = "https://commons.wikimedia.org/wiki/File:Boston_Tea_Party_music_venue.jpg";
  const result = quarantineInvalidVenuePhotos({
    mixed: { galleryPool: [{ sourcePage: bad, uri: "https://media.example/bad.webp" }, { sourcePage: good, uri: "https://media.example/good.webp" }] },
    onlyBad: { galleryPool: [{ sourcePage: bad, uri: "https://media.example/bad.webp" }] },
  });
  assert.equal(result.removedPhotos, 2);
  assert.equal(result.removedVenues, 1);
  assert.equal(result.inventory.onlyBad, undefined);
  assert.deepEqual(result.inventory.mixed.photos, ["https://media.example/good.webp"]);
});
