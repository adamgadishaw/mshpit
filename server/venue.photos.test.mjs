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
  assert.equal(headers["Cache-Control"], "public, max-age=60, must-revalidate");
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
