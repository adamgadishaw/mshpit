import assert from "node:assert/strict";
import test from "node:test";
import { routes } from "./api.js";
import { createApiResponseHeaderSetter } from "./responseHeaders.js";

const getPhotos = routes["GET /api/venues/:key/photos"];

test("venue photo endpoint fails closed for the legacy unverified catalog", () => {
  const headers = {};
  const result = getPhotos({
    params: { key: encodeURIComponent("Wollman Auditorium") },
    setHeader: createApiResponseHeaderSetter(headers),
  });

  assert.equal(result.key, "wollman auditorium");
  assert.deepEqual(result.photos, []);
  assert.deepEqual(result.fanPhotos, []);
  assert.equal(headers["Cache-Control"], "private, no-store");
});

test("venue photo endpoint handles missing pools and malformed route encoding safely", () => {
  assert.deepEqual(getPhotos({ params: { key: "venue-with-no-photo-pool" } }), {
    key: "venue-with-no-photo-pool",
    photos: [],
    fanPhotos: [],
  });
  assert.throws(
    () => getPhotos({ params: { key: "%E0%A4%A" } }),
    (error) => error?.status === 400 && error?.code === "VALIDATION_FAILED",
  );
  for (const query of [
    { source: "ticketmaster" },
    { providerVenueId: "venue-only" },
    { source: "x".repeat(41), providerVenueId: "venue" },
  ]) {
    assert.throws(
      () => getPhotos({ params: { key: "sample-hall" }, query }),
      (error) => error?.status === 400 && error?.code === "VALIDATION_FAILED",
    );
  }
});

test("venue photo endpoint never gives an unmapped provider venue a same-name photo", () => {
  const providerResult = getPhotos({
    params: { key: encodeURIComponent("Rogers Centre") },
    query: { source: "Ticketmaster", providerVenueId: "unfilled-provider-key" },
  });
  assert.equal(providerResult.key, "rogers centre");
  assert.deepEqual(providerResult.photos, []);

  const legacyResult = getPhotos({
    params: { key: encodeURIComponent("Rogers Centre") },
  });
  assert.equal(legacyResult.key, "rogers centre");
  assert.ok(legacyResult.photos.length > 0);
  assert.ok(legacyResult.photos.every((photo) => photo.source === "licensed"));
});
