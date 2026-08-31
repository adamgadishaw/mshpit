import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cleanVenueFanPhotoResponse,
  cleanVenuePhotoResponse,
  isFreshVenuePhotoEntry,
  mergeVenuePhotoSources,
  venuePhotoAttemptScope,
  venuePhotoScopedCacheKey,
  venuePhotoViewerScope,
  VENUE_PHOTO_CATALOG_VERSION,
  VENUE_FAN_PHOTO_RESPONSE_MAX,
  venuePhotoStateFor,
  withBoundedVenuePhotoCache,
} from "./venuePhotos.mjs";
import { licensedVenuePhoto, venueCatalogPhotoFields, venueMapPhotoPresentation, venuePhotoAttribution } from "./venuePhotoProvenance.mjs";

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

test("venue photo attribution exposes only validated presentation fields", () => {
  const presented = venuePhotoAttribution({
    ...licensedPhoto(7),
    modificationNotice: "Converted to WebP and resized when needed by MSHpit for delivery.",
    providerTitle: "must not be exposed",
    mirroredFrom: "https://private.example/original",
    mirror: { objectKey: "must-not-pass-through" },
  });
  assert.deepEqual(presented, {
    creator: "Photographer 7",
    license: "CC BY 4.0",
    sourcePage: "https://catalog.example/photos/7",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modificationNotice: "Converted to WebP and resized when needed by MSHpit for delivery.",
  });
  assert.equal(venuePhotoAttribution({ ...licensedPhoto(8), sourcePage: "javascript:alert(1)" }), null);
  assert.equal(venuePhotoAttribution({ ...licensedPhoto(9), licenseUrl: "https://evil.example/fake-license" }), null);
});

test("venue map cards render only an exact, fully attributed licensed photo", () => {
  const valid = licensedPhoto(13);
  const presented = venueMapPhotoPresentation(valid, valid.uri);
  assert.equal(presented.uri, valid.uri);
  assert.deepEqual(presented.attribution, venuePhotoAttribution(valid));
  assert.equal(venueMapPhotoPresentation(valid, "https://images.example/different.jpg"), null);
  assert.equal(venueMapPhotoPresentation({ uri: valid.uri, photoCredit: "Source: web" }, valid.uri), null);

  const nearbySource = readFileSync(new URL("../screens/NearbyScreen.jsx", import.meta.url), "utf8");
  const liveMapSource = readFileSync(new URL("../components/LiveMap.jsx", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  assert.match(storeSource, /photoProvenance:\s*catalogPhoto\.photoProvenance/u);
  assert.match(nearbySource, /photoProvenance:\s*summary\.photoProvenance/u);
  assert.match(liveMapSource, /venueMapPhotoPresentation\(p\.photoProvenance, p\.photo\)/u);
  assert.match(liveMapSource, /SafeAttributionLink label="Source"/u);
  assert.match(liveMapSource, /SafeAttributionLink label=\{attribution\.license\}/u);
});

test("fan venue-photo responses use a separate strict, bounded projection", () => {
  const valid = Array.from({ length: 16 }, (_, index) => ({
    uri: `https://media.example/fan-${index}.webp`,
    source: "fan",
    origin: index % 2 ? "post" : "venue-review",
    ...(index % 2 ? { postId: `post-${index}` } : { venueReviewId: `review-${index}` }),
    createdAt: 1000 + index,
    ownerId: "fan-owner",
  }));
  const result = cleanVenueFanPhotoResponse([
    { ...valid[0], uri: "javascript:alert(1)" },
    { ...valid[0], source: "licensed" },
    { ...valid[0], origin: "profile" },
    { ...valid[1], postId: "" },
    ...valid,
    valid[0],
  ]);
  assert.equal(result.length, VENUE_FAN_PHOTO_RESPONSE_MAX);
  assert.deepEqual(
    Object.keys(result[0]).sort(),
    ["createdAt", "origin", "ownerId", "source", "uri", "venueReviewId"].sort(),
  );
  assert.equal(result[0].ownerId, "fan-owner");
  assert.equal(new Set(result.map((photo) => photo.uri)).size, result.length);
  assert.ok(result.every((photo) => photo.source === "fan"));
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

test("viewer-specific venue photo caches cannot cross accounts or block boundaries", () => {
  const venue = "history";
  const accountA = venuePhotoViewerScope("account-a", [], 0);
  const accountB = venuePhotoViewerScope("account-b", [], 1);
  const blocked = venuePhotoViewerScope("account-a", ["fan-b", "fan-a"], 1);
  const blockedReordered = venuePhotoViewerScope("account-a", ["fan-a", "fan-b", "fan-a"], 1);
  const unblocked = venuePhotoViewerScope("account-a", [], 2);
  const guest = venuePhotoViewerScope(null, [], 3);

  assert.equal(blocked, blockedReordered, "equivalent block snapshots share one deterministic scope");
  assert.notEqual(accountA, accountB);
  assert.notEqual(accountA, blocked);
  assert.notEqual(accountA, unblocked, "unblock must not restore the pre-block scope");
  assert.notEqual(accountA, guest);
  assert.equal(venuePhotoViewerScope("   ", [], 3), guest);

  const cachedForA = venuePhotoScopedCacheKey(venue, accountA);
  const cache = new Map([[cachedForA, { fanPhotos: [{ uri: "https://img.test/private-to-a.jpg" }] }]]);
  for (const scope of [accountB, blocked, unblocked, guest]) {
    assert.equal(cache.get(venuePhotoScopedCacheKey(venue, scope)), undefined);
  }
});

test("personalized venue-photo JSON bypasses browser caches", () => {
  const featureSource = readFileSync(new URL("../features/venuePhotos/venuePhotoApi.mjs", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../lib/api.js", import.meta.url), "utf8");
  assert.match(featureSource, /cache:\s*"no-store"/u);
  assert.match(apiSource, /\.\.\.\(cache \? \{ cache \} : \{\}\)/u);
});

test("the Store rotates venue-photo privacy state on account, block, and unblock boundaries", () => {
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const accountBoundary = store.slice(
    store.indexOf("const adoptFeedAccount ="),
    store.indexOf("useEffect(() => {\n    const nextAccountId", store.indexOf("const adoptFeedAccount =")),
  );
  const blockBoundary = store.slice(
    store.indexOf("const blockUser ="),
    store.indexOf("const blockedUsers =", store.indexOf("const blockUser =")),
  );
  const blockHydrationBoundary = store.slice(
    store.indexOf("const refreshBlockedDirectory ="),
    store.indexOf("const blockUser =", store.indexOf("const refreshBlockedDirectory =")),
  );
  const venueRead = store.slice(
    store.indexOf("const waitForVenuePhotoRequest ="),
    store.indexOf("const venuePhotos =", store.indexOf("const loadVenuePhotos =")),
  );

  assert.match(accountBoundary, /if \(nextAccountId === feedAccountIdRef\.current\) return;\s+rotateVenuePhotoPrivacyScope\(\{[\s\S]*?accountId: nextAccountId,[\s\S]*?blockGraphAuthoritative:/u);
  assert.equal((blockBoundary.match(/beginVenuePhotoPrivacyMutation\(id\)/gu) || []).length, 2,
    "both block directions must hide fan photos before their writes begin");
  assert.ok((blockBoundary.match(/finishVenuePhotoPrivacyMutation\(id\)/gu) || []).length >= 4,
    "both confirmed writes and both rollback paths must refetch the authoritative graph");
  assert.match(blockHydrationBoundary, /blockedIdsRef\.current = ids;\s+setVenueReviews\([\s\S]*?rotateVenuePhotoPrivacyScope\(\{ accountId, blockGraphAuthoritative: true \}\);\s+setBlockedIds\(ids\)/u,
    "authoritative block hydration must invalidate a pool fetched before hydration completed");
  assert.match(venueRead, /venuePhotoScopedCacheKey\(venueKey, viewerScope\)/u);
  assert.match(venueRead, /currentVenuePhotoViewerScope\(\) !== viewerScope/u,
    "a late response from the previous viewer scope must never commit");
  assert.ok(venueRead.includes("if (active) return waitForVenuePhotoRequest(active.promise, signal)"),
    "a second screen must share the in-flight transport while keeping its own cancellation");
  assert.ok(!venueRead.includes('signal?.addEventListener("abort", abortRequest'),
    "one screen's AbortSignal must never abort a transport another screen shares");
  assert.match(store, /const fan = privacy\.pendingMutations\?\.size \? \[\] : \[/u,
    "fan photos must remain hidden while a block or unblock write is unsettled");
});

test("venue review photos require explicit public-gallery consent", () => {
  const reviewScreen = readFileSync(new URL("../screens/VenueReviewScreen.jsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  assert.match(reviewScreen, /const \[photosPublic, setPhotosPublic\] = useState\(false\)/u);
  assert.match(reviewScreen, /accessibilityRole="checkbox"[\s\S]*?Add these to the public venue gallery/u);
  assert.match(reviewScreen, /Optional and off by default\.[\s\S]*?crawler-readable concert archives/u);
  assert.match(reviewScreen, /photosPublic: photos\.length > 0 && photosPublic/u);
  assert.match(store, /photos: photosPublic \? selectedPhotos : \[\]/u,
    "non-consenting photos must not enter the optimistic public gallery");
  assert.match(store, /photos: selectedPhotos, photosPublic: !!photosPublic/u,
    "the server must receive a separate explicit consent bit");
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
