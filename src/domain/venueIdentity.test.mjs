import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalVenueKey,
  normalizeVenueKey,
  resolveVenueCatalogKey,
  venueIdentityFingerprint,
  venueLookupKeys,
  venueLookupSlugs,
} from "./venueIdentity.mjs";

test("known venue renames resolve to one explicit canonical identity", () => {
  assert.equal(canonicalVenueKey("RBC Amphitheatre"), "budweiser stage");
  assert.equal(canonicalVenueKey("RBC Amphitheater"), "budweiser stage");
  assert.equal(canonicalVenueKey("Budweiser Stage"), "budweiser stage");
  assert.equal(canonicalVenueKey("History Toronto"), "history");
  assert.deepEqual(new Set(venueLookupKeys("RBC Amphitheatre")), new Set([
    "budweiser stage", "rbc amphitheatre", "rbc amphitheater",
  ]));
});

test("European venue rebrands retain one identity without cross-city guesses", () => {
  assert.equal(canonicalVenueKey("Altice Arena"), "meo arena");
  assert.equal(canonicalVenueKey("WiZink Center"), "movistar arena madrid");
  assert.equal(canonicalVenueKey("Friends Arena"), "strawberry arena");
  assert.equal(canonicalVenueKey("Tele2 Arena"), "3arena stockholm");
  assert.equal(canonicalVenueKey("The O2 Dublin"), "3arena dublin");
  assert.equal(canonicalVenueKey("O2 World Berlin"), "uber arena");
  assert.equal(canonicalVenueKey("Sazka Arena"), "o2 arena prague");
  assert.equal(resolveVenueCatalogKey("Altice Arena", ["meo arena"]), "meo arena");
  assert.equal(canonicalVenueKey("3Arena"), "3arena");
  assert.equal(canonicalVenueKey("O2 Arena"), "o2 arena");
});

test("venue equality normalization handles typography without fuzzy guesses", () => {
  assert.equal(normalizeVenueKey("  Buddy’s   Place  "), "buddy's place");
  assert.equal(venueIdentityFingerprint("Thé-Room & Hall"), "the room and hall");
  assert.deepEqual(venueLookupSlugs("Buddy’s Place"), ["buddys-place"]);
  assert.equal(canonicalVenueKey("History Hall"), "history hall");
  assert.notEqual(canonicalVenueKey("History Hall"), canonicalVenueKey("History"));
});

test("catalog resolution accepts exact typography variants and fails closed on collisions", () => {
  assert.equal(resolveVenueCatalogKey("RBC Amphitheatre", ["budweiser stage", "other room"]), "budweiser stage");
  assert.equal(resolveVenueCatalogKey("Buddy’s Place", ["buddy's place"]), "buddy's place");
  assert.equal(resolveVenueCatalogKey("Fillmore Detroit", ["The Fillmore Detroit", "Fillmore Charlotte"]), "The Fillmore Detroit");
  assert.equal(resolveVenueCatalogKey("Foo.Bar", ["foo-bar", "foo bar"]), null);
  assert.equal(resolveVenueCatalogKey("Fillmore", ["Fillmore", "The Fillmore"]), "Fillmore");
});
