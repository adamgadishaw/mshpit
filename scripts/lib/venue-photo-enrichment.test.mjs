import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { verifiedVenuePhotoBackfillConfigured } from "./venue-photo-enrichment.mjs";

test("venue-photo enrichment requires controlled public media storage", () => {
  assert.equal(verifiedVenuePhotoBackfillConfigured({}), false);
  assert.equal(verifiedVenuePhotoBackfillConfigured({ OPENVERSE_API_TOKEN: "irrelevant" }), false);
  assert.equal(verifiedVenuePhotoBackfillConfigured({
    MEDIA_BUCKET: "photos",
    MEDIA_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    MEDIA_PUBLIC_BASE_URL: "https://media.example",
    MEDIA_REGION: "auto",
    MEDIA_ACCESS_KEY_ID: "key",
    MEDIA_SECRET_ACCESS_KEY: "secret",
  }), true);
});

test("the recurring pipeline uses only the hardened Commons mirror path", () => {
  const source = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(source, /verifiedVenuePhotoBackfillConfigured\(process\.env\)/u);
  assert.match(source, /public media storage is not configured/u);
  assert.match(source, /enrich-venue-photos\.mjs/u);
  assert.doesNotMatch(source, /OPENVERSE_API_TOKEN/u);
  const enrichment = readFileSync(new URL("../enrich-venue-photos.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(enrichment, /api\.openverse\.org|OPENVERSE_API_TOKEN/u);
  assert.match(enrichment, /backfill-verified-venue-photos\.mjs/u);
});
