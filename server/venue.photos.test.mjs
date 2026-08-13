import assert from "node:assert/strict";
import test from "node:test";
import { routes } from "./api.js";
import { createApiResponseHeaderSetter } from "./responseHeaders.js";

const getPhotos = routes["GET /api/venues/:key/photos"];

test("venue photo endpoint returns one normalized, bounded, cacheable pool", () => {
  const headers = {};
  const result = getPhotos({
    params: { key: encodeURIComponent("Wollman Auditorium") },
    setHeader: createApiResponseHeaderSetter(headers),
  });

  assert.equal(result.key, "wollman auditorium");
  assert.ok(result.photos.length > 0);
  assert.ok(result.photos.length <= 24);
  assert.equal(new Set(result.photos.map((photo) => photo.uri)).size, result.photos.length);
  assert.ok(result.photos.every((photo) => /^https?:\/\//.test(photo.uri)));
  assert.ok(result.photos.every((photo) => typeof photo.by === "string" && photo.by.length > 0));
  assert.ok(result.photos.every((photo) => ["commons", "openverse", "web"].includes(photo.source)));
  assert.equal(headers["Cache-Control"], "public, max-age=3600, stale-while-revalidate=86400");
});

test("venue photo endpoint handles missing pools and malformed route encoding safely", () => {
  assert.deepEqual(getPhotos({ params: { key: "venue-with-no-photo-pool" } }), {
    key: "venue-with-no-photo-pool",
    photos: [],
  });
  assert.throws(
    () => getPhotos({ params: { key: "%E0%A4%A" } }),
    (error) => error?.status === 400 && error?.code === "VALIDATION_FAILED",
  );
});
