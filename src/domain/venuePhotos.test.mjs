import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cleanVenuePhotoResponse,
  isFreshVenuePhotoEntry,
  mergeVenuePhotoSources,
  venuePhotoAttemptScope,
  VENUE_PHOTO_CATALOG_VERSION,
  venuePhotoStateFor,
  withBoundedVenuePhotoCache,
} from "./venuePhotos.mjs";
import { licensedVenuePhoto, venueCatalogPhotoFields } from "./venuePhotoProvenance.mjs";

const licensedPhoto = (index = 0) => ({
  uri: `https://images.example/${index}.jpg`,
  creator: `Photographer ${index}`,
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  sourcePage: `https://catalog.example/photos/${index}`,
  source: "openverse",
});

test("venue photo responses require licensed HTTPS provenance and stay bounded", () => {
  assert.match(VENUE_PHOTO_CATALOG_VERSION, /^licensed-v[1-9][0-9]*$/u);
  const input = Array.from({ length: 30 }, (_, index) => licensedPhoto(index));
  input.unshift({ uri: "javascript:alert(1)", by: "bad", source: "web" });
  input.unshift({ ...licensedPhoto(99), uri: "http://images.example/99.jpg" });
  input.push(input[5]);

  const result = cleanVenuePhotoResponse(input);
  assert.equal(result.length, 24);
  assert.equal(result[0].by, "Photographer 0 · CC BY 4.0");
  assert.ok(result.every((photo) => /^https:\/\//.test(photo.uri)));
  assert.ok(result.every((photo) => photo.source === "licensed"));
  assert.equal(new Set(result.map((photo) => photo.uri)).size, result.length);
});

test("legacy labels cannot stand in for machine-verifiable venue photo rights", () => {
  assert.ok(licensedVenuePhoto(licensedPhoto(1)));
  assert.equal(licensedVenuePhoto({
    uri: "https://images.example/legacy.jpg",
    credit: "Someone · BY 4.0",
    source: "commons",
  }), null);
  assert.equal(licensedVenuePhoto({ ...licensedPhoto(2), source: "web" }), null);
  assert.equal(licensedVenuePhoto({ ...licensedPhoto(3), creator: "Source: web" }), null);
  assert.equal(licensedVenuePhoto({
    ...licensedPhoto(4),
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  }), null);
  assert.equal(licensedVenuePhoto({ ...licensedPhoto(5), license: "ARR" }), null);
});

test("venue photo normalization is idempotent and preserves provider provenance", () => {
  const once = licensedVenuePhoto({ ...licensedPhoto(6), source: "commons" });
  const twice = licensedVenuePhoto(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.provenanceSource, "commons");

  const migrated = licensedVenuePhoto({
    ...once,
    source: "licensed",
    provenanceSource: "licensed",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Example_venue.jpg",
  });
  assert.equal(migrated.provenanceSource, "commons");
});

test("venue directory cards fail closed on legacy core photos and route through the provenance policy", () => {
  assert.deepEqual(venueCatalogPhotoFields({
    photo: "http://unlicensed.example/venue.jpg",
    photoCredit: "Source: web",
  }), { photo: null, photoCredit: null, photoProvenance: null });
  const verified = venueCatalogPhotoFields({
    photo: "https://images.example/venue.jpg",
    photoCreator: "Venue Photographer",
    photoLicense: "CC-BY-4.0",
    photoLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    photoSourcePage: "https://catalog.example/venue-photo",
    photoSource: "licensed",
  });
  assert.equal(verified.photo, "https://images.example/venue.jpg");
  assert.match(verified.photoCredit, /^Venue Photographer .* CC BY 4\.0$/);

  const core = JSON.parse(readFileSync(new URL("../seed/catalog.core.json", import.meta.url), "utf8"));
  const seeded = Object.values(core.venues || {}).filter((venue) => venue?.photo);
  assert.ok(seeded.length > 0, "fixture must exercise the legacy venue-photo catalog");
  const legacy = seeded.filter((venue) => !venue.photoSourcePage);
  assert.equal(legacy.filter((venue) => venueCatalogPhotoFields(venue).photo).length, 0,
    "photoCredit text alone must never reactivate legacy inventory");
  assert.ok(seeded.some((venue) => venueCatalogPhotoFields(venue).photo),
    "fresh provider metadata can safely activate verified directory-card leads");
  const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  assert.match(storeSource, /const catalogPhoto = venueCatalogPhotoFields\(cat\)/);
  assert.doesNotMatch(storeSource, /photo:\s*\(cat\s*&&\s*cat\.photo\)/,
    "venueSummary must not bypass the shared provenance policy");
});

test("venue photo memory cache is LRU-bounded and expires", () => {
  let cache = new Map();
  cache = withBoundedVenuePhotoCache(cache, "a", { status: "ready", loadedAt: 100 }, 2);
  cache = withBoundedVenuePhotoCache(cache, "b", { status: "ready", loadedAt: 200 }, 2);
  cache = withBoundedVenuePhotoCache(cache, "c", { status: "ready", loadedAt: 300 }, 2);
  assert.deepEqual([...cache.keys()], ["b", "c"]);
  assert.equal(isFreshVenuePhotoEntry(cache.get("c"), 300 + 14 * 60 * 1000), true);
  assert.equal(isFreshVenuePhotoEntry(cache.get("c"), 300 + 16 * 60 * 1000), false);
});

test("venue photo merge preserves community media ahead of licensed backfill", () => {
  const remote = [
    { uri: "https://img/backfill.jpg", source: "licensed" },
    { uri: "https://img/official.jpg", source: "licensed" },
  ];
  const fan = [
    { uri: "https://img/fan.jpg", source: "fan" },
    { uri: "https://img/official.jpg", source: "fan" },
  ];
  assert.deepEqual(
    mergeVenuePhotoSources(remote, fan, (uri) => uri.endsWith("backfill.jpg")).map((photo) => photo.uri),
    ["https://img/fan.jpg", "https://img/official.jpg"],
  );
});

test("verified fan media leads licensed provider photos after provenance normalization", () => {
  const remote = [
    { uri: "https://img/openverse.jpg", source: "licensed", provenanceSource: "openverse" },
    { uri: "https://img/commons.jpg", source: "licensed", provenanceSource: "commons" },
  ];
  const fan = [{ uri: "https://img/fan.jpg", source: "fan" }];
  assert.deepEqual(
    mergeVenuePhotoSources(remote, fan).map((photo) => photo.uri),
    ["https://img/fan.jpg", "https://img/commons.jpg", "https://img/openverse.jpg"],
  );
});

test("venue photo delivery attempts are scoped to both venue and photo identity", () => {
  const photos = [{ uri: "https://img/one.jpg" }, { uri: "https://img/two.jpg" }];
  const scope = venuePhotoAttemptScope("History", photos);
  assert.equal(scope, venuePhotoAttemptScope(" history ", photos));
  assert.notEqual(scope, venuePhotoAttemptScope("The Opera House", photos));
  assert.notEqual(scope, venuePhotoAttemptScope("History", photos.slice(0, 1)));
  assert.notEqual(scope, venuePhotoAttemptScope("History", photos.slice().reverse()));
});

test("a venue without a catalog key settles as an empty result instead of loading forever", () => {
  assert.deepEqual(venuePhotoStateFor(null, {}), { status: "ready", photos: [], error: null });
  assert.deepEqual(venuePhotoStateFor("known", {}), { status: "idle", photos: [], error: null });
  const ready = { status: "ready", photos: [{ uri: "https://img/venue.jpg" }], error: null };
  assert.equal(venuePhotoStateFor("known", { known: ready }), ready);
});
