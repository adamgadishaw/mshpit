import test from "node:test";
import assert from "node:assert/strict";
import { discoverPhotoAttribution } from "./discoverPhotoCredits.mjs";

const provider = { source: "provider", provider: "ticketmaster", by: "Recorded promoter", sourcePage: "https://example.test/event" };
const licensed = { source: "commons", by: "Recorded photographer", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", sourcePage: "https://example.test/photo" };

test("provider photo credits retain the source without inventing a license", () => {
  assert.deepEqual(discoverPhotoAttribution(provider), { creator: provider.by, sourcePage: provider.sourcePage, provider: "ticketmaster" });
  assert.equal(discoverPhotoAttribution({ ...provider, sourcePage: "javascript:alert(1)" }), null);
  assert.equal(discoverPhotoAttribution({ ...provider, by: "" }), null);
  assert.equal(discoverPhotoAttribution({ ...provider, provider: "unknown" }), null);
});

test("licensed photo credits retain the supplied creator and both actionable links", () => {
  assert.deepEqual(discoverPhotoAttribution(licensed), { creator: licensed.by, license: licensed.license, sourcePage: licensed.sourcePage, licenseUrl: licensed.licenseUrl });
  for (const field of ["by", "license", "sourcePage", "licenseUrl"]) assert.equal(discoverPhotoAttribution({ ...licensed, [field]: "" }), null);
  assert.equal(discoverPhotoAttribution({ ...licensed, licenseUrl: "http://example.test" }), null);
  assert.equal(discoverPhotoAttribution({ ...licensed, sourcePage: "https://user:pass@example.test/photo" }), null);
});

test("plain fan/catalog credits do not become fabricated licenses or source links", () => {
  assert.equal(discoverPhotoAttribution({ source: "catalog", by: "deezer" }), null);
  assert.equal(discoverPhotoAttribution({ source: "fan", by: "A fan" }), null);
  assert.equal(discoverPhotoAttribution(null), null);
});
