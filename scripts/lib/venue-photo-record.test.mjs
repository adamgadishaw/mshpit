import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { licensedVenuePhoto } from "../../src/domain/venuePhotoProvenance.mjs";
import {
  hasLicensedVenuePhoto, licensedVenuePool, needsLicensedVenuePhoto,
  needsLicensedVenuePhotoAcross, recoverLicensedVenuePhoto,
} from "./venue-photo-record.mjs";

test("legacy credits and provider hosts never reconstruct publication rights", () => {
  const commons = recoverLicensedVenuePhoto({
    uri: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_Hall.jpg/800px-Test_Hall.jpg",
    credit: "Example Creator · BY-SA 4.0 · (wikimedia)", source: "openverse",
  });
  const flickr = recoverLicensedVenuePhoto({
    uri: "https://live.staticflickr.com/65535/54368216737_f813343a2a_b.jpg",
    credit: "Example Creator · BY 2.0 · (flickr)", source: "openverse",
  });
  assert.equal(commons, null);
  assert.equal(flickr, null);
  assert.equal(recoverLicensedVenuePhoto({ uri: "https://example.com/a.jpg", credit: "Source: web", source: "web" }), null);
});

test("catalog publication emits only complete validator-approved records", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../src/seed/catalog.venue-photos.json", import.meta.url), "utf8"));
  const emitted = Object.values(catalog).flatMap((entry) => licensedVenuePool(entry));
  assert.equal(emitted.filter((entry) => !licensedVenuePhoto(entry)).length, 0);
  const fixture = {
    uri: "https://images.example/venue.jpg", sourcePage: "https://catalog.example/venue.jpg",
    creator: "Venue Photographer", license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/", source: "openverse",
  };
  assert.equal(licensedVenuePool({ galleryPool: [fixture] }).length, 1,
    "corrected ingestors can publish complete records without relaxing validation");
  assert.equal(catalog["panthéon"], undefined, "a nearby university namesake is not published as the venue");
  assert.equal(catalog["schloßplatz"], undefined, "a walkable city map is not published as the venue");
  assert.deepEqual(
    catalog.satyricon?.galleryPool?.map((photo) => photo.sourcePage),
    ["https://commons.wikimedia.org/wiki/File:Satyricon.png"],
    "the real Satyricon venue photo remains while namesake sculptures stay excluded",
  );
});

test("pipeline completeness ignores legacy URLs and accepts only validated pools", () => {
  const fixture = {
    uri: "https://images.example/venue.png",
    sourcePage: "https://catalog.example/venue",
    creator: "Venue Photographer",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    source: "openverse",
    providerTitle: "File:Example Venue.png",
  };
  assert.equal(needsLicensedVenuePhoto({
    photo: "https://legacy.example/lead.jpg",
    photos: ["https://legacy.example/gallery.jpg"],
    galleryPool: [{ uri: "https://legacy.example/gallery.jpg", credit: "Source: web" }],
  }), true);
  assert.equal(hasLicensedVenuePhoto({ galleryPool: [fixture] }), true,
    "licensed PNG photographs are valid inventory");
  assert.equal(needsLicensedVenuePhoto({ galleryPool: [fixture] }), false);
  assert.equal(needsLicensedVenuePhotoAcross(
    { photo: "https://legacy.example/lead.jpg" },
    { galleryPool: [fixture] },
  ), false, "a verified overlay satisfies completeness without rewriting the source catalog");
  assert.equal(hasLicensedVenuePhoto({
    galleryPool: [{ ...fixture, providerTitle: "File:Example Venue.svg" }],
  }), false, "vector artwork stays excluded from the photograph pool");
  assert.equal(hasLicensedVenuePhoto({
    galleryPool: [{ ...fixture, providerTitle: "File:Begehbare Berlinkarte, Schloßplatz.jpg" }],
  }), false, "multilingual map titles stay excluded from the photograph pool");
});
