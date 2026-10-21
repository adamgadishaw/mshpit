import assert from "node:assert/strict";
import test from "node:test";
import { buildMapLibreVenueCatalogue, readCatalogueProjectionInputs, AUDITED_IMPORT_TUPLE_SHA256 } from "./build-maplibre-venue-catalogue.mjs";

const inputs = readCatalogueProjectionInputs();
const projection = buildMapLibreVenueCatalogue(inputs);

test("all catalogue identities survive while imported, curated and missing coordinate gaps remain distinct", () => {
  assert.equal(projection.venues.length, 1060);
  assert.equal(new Set(projection.venues.map((row) => row.id)).size, 1060);
  assert.deepEqual(projection.counts, { total: 1060, withCatalogueCoordinates: 1056,
    eligible: 952, missing: 0, invalid: 0, uncertain: 108,
    ingestionBatch: 947, individuallyVerified: 5, coordinateOverrides: 22 });
  assert.equal(projection.generatedFrom.sourceSnapshotTupleSha256, AUDITED_IMPORT_TUPLE_SHA256);
  const forbidden = /photo|gallery|reviews|rating|ticket|artist|user|email|spotify|deezer/iu;
  assert.ok(projection.venues.every((row) => Object.keys(row).every((key) => !forbidden.test(key))));
});

test("the original independently imported point overrides an unsourced curated coordinate without relabelling it", () => {
  const row = projection.venues.find((venue) => venue.id === "first avenue");
  assert.equal(row.lat, 44.9785);
  assert.equal(row.lng, -93.2762);
  assert.deepEqual(row.mapCoordinate, { lat: 44.978, lng: -93.27594 });
  assert.equal(row.coordinateProvenance.basis, "ingestion-batch");
  assert.equal(row.coordinateProvenance.perRecordVerified, false);
  assert.equal(row.coordinateProvenance.sourceId, undefined);
  assert.equal(projection.venues.find((venue) => venue.id === "the independent").coordinateEligibility, "uncertain");
  assert.equal(projection.venues.find((venue) => venue.id === "wembley stadium").coordinateEligibility, "uncertain");
  assert.equal(projection.venues.find((venue) => venue.id === "webster hall").coordinateProvenance.basis, "individually-verified");
});

test("four historical photo-only identities gain sourced places and separate independent map points", () => {
  for (const key of ["the orpheum theatre", "the wiltern", "webster hall", "the roxy theatre"]) {
    const row = projection.venues.find((venue) => venue.id === key);
    assert.equal(row.lat, null);
    assert.equal(row.lng, null);
    assert.equal(row.coordinateEligibility, "eligible");
    assert.equal(row.coordinateProvenance.basis, "individually-verified");
    assert.equal(row.coordinateProvenance.source, "Wikidata");
    assert.equal(row.identityProvenance.basis, "official-venue-address");
    assert.equal(row.identityProvenance.checkedAt, "2026-10-21");
    assert.match(row.identityProvenance.ingestionSource, /ingest-famous-venue-photos/u);
    assert.ok(row.mapCoordinate);
    assert.ok(row.place.endsWith(", United States"));
  }
});

test("reviewed name-only identity enrichment cannot transfer by reusing a key or asserting a source", () => {
  for (const change of [{ name: "Another Orpheum" }, { place: "Vancouver, British Columbia, Canada" },
    { name: "Orpheum Theatre", place: "Unqualified" }]) {
    const changed = structuredClone(inputs);
    Object.assign(changed.core.venues["the orpheum theatre"], change);
    const row = buildMapLibreVenueCatalogue(changed).venues.find((venue) => venue.id === "the orpheum theatre");
    assert.equal(row.identityProvenance, undefined);
    assert.equal(row.coordinateEligibility, "missing");
    assert.equal(row.mapCoordinate, undefined);
  }
});

test("new source assertions or altered immutable import tuples cannot expand the audited batch", () => {
  const changed = structuredClone(inputs);
  changed.core.venues["new asserted hall"] = { name: "New asserted hall", place: "London, England, United Kingdom", lat: 51.5, lng: -0.1, capacity: null, source: "MusicBrainz" };
  changed.core.venues["first avenue"].lat = 1;
  const result = buildMapLibreVenueCatalogue(changed);
  assert.equal(result.venues.find((venue) => venue.id === "new asserted hall").coordinateEligibility, "uncertain");
  assert.equal(result.venues.find((venue) => venue.id === "first avenue").coordinateEligibility, "uncertain");
  changed.snapshot.venues["first avenue"].lat = 1;
  assert.throws(() => buildMapLibreVenueCatalogue(changed), /audited import tuple hash changed/u);
});

test("a reused curated key cannot transfer an imported point to a different venue identity", () => {
  for (const change of [{ name: "Another First Avenue" }, { place: "London, England, United Kingdom" }, { place: "Minneapolis, Kansas, United States" }]) {
    const changed = structuredClone(inputs);
    Object.assign(changed.curated["first avenue"], change);
    assert.equal(buildMapLibreVenueCatalogue(changed).venues.find((row) => row.id === "first avenue").coordinateEligibility, "uncertain");
  }
});
