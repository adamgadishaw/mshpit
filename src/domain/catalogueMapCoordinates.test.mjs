import assert from "node:assert/strict";
import test from "node:test";
import { buildMapLibreVenueCatalogue, readCatalogueProjectionInputs } from "../../scripts/build-maplibre-venue-catalogue.mjs";
import { catalogueMapPoints, createCatalogueMapResolver, TICKETMASTER_WITNESS_MAX_AGE_MS } from "./catalogueMapCoordinates.mjs";

const catalogue = buildMapLibreVenueCatalogue(readCatalogueProjectionInputs());
const resolve = createCatalogueMapResolver(catalogue.venues);

test("a complete trusted catalogue resolves every eligible venue without a result cap", () => {
  const points = catalogueMapPoints(catalogue.venues, catalogue.venues);
  assert.equal(points.length, 952);
  assert.equal(new Set(points.map((row) => row.id)).size, 952);
  assert.equal(points.filter((row) => row.coordinateProvenance.perRecordVerified).length, 5);
  assert.equal(points.filter((row) => row.coordinateProvenance.basis === "ingestion-batch").length, 947);
});

test("source point overrides retain caller identity and metadata without mutating a legacy or missing point", () => {
  for (const coord of [undefined, { lat: 999, lng: 999 }, { lat: 0, lng: 0 }]) {
    const row = Object.freeze({ id: "existing-app-id", name: "First Avenue", place: "Minneapolis, Minnesota, United States", coord, mapNumber: 9 });
    const result = resolve(row);
    assert.equal(result.id, "existing-app-id");
    assert.equal(result.mapNumber, 9);
    assert.deepEqual(result.coord, { lat: 44.978, lng: -93.27594 });
    assert.equal(result.coordinateProvenance.perRecordVerified, false);
    assert.equal(row.coord, coord);
  }
});

test("same names in other or incomplete places, unknown records and provider provenance assertions stay unmapped", () => {
  for (const row of [
    { name: "First Avenue", place: "Minneapolis" },
    { name: "First Avenue", place: "London, England, United Kingdom" },
    { name: "The Independent", place: "San Francisco, California, United States", lat: 37.7765, lng: -122.4376 },
    { name: "Wembley Stadium", place: "London, United Kingdom", lat: 51.556, lng: -.2796 },
    { name: "Invented new venue", place: "Toronto, Ontario, Canada", lat: 43.6, lng: -79.3, coordinateProvenance: { source: "MusicBrainz", basis: "ingestion-batch" } },
    { name: "First Avenue", place: "Minneapolis, Minnesota, United States", source: "Google" },
    { name: "First Avenue", place: "Minneapolis, Minnesota, United States", coordinatePrecision: "city" },
    { name: "First Avenue", place: "Minneapolis, Minnesota, United States", city: "London" },
    { name: "First Avenue", place: "Minneapolis, Minnesota, United States", countryCode: "CA" },
    { name: "First Avenue", place: "Minneapolis, Minnesota, United States", region: "Kansas" },
    { name: "First Avenue", place: "Minneapolis, Minnesota, United States", source: "MusicBrainz", providerVenueId: "wrong-id" },
    { name: "Horseshoe Tavern", place: "Toronto, Ontario, Canada", source: "MusicBrainz", providerVenueId: "wrong-id" },
    { name: "Horseshoe Tavern", place: "Toronto, Ontario, Canada", city: "London" },
  ]) assert.equal(resolve(row), null, JSON.stringify(row));
  assert.ok(resolve({ name: "First Avenue", place: "Minneapolis, Minnesota, United States", city: "Minneapolis", region: "MN", countryCode: "US" }));
});

test("ambiguous trusted registrations fail closed and an empty registry retains only explicit independent overrides", () => {
  const entry = catalogue.venues.find((row) => row.id === "first avenue");
  const ambiguous = createCatalogueMapResolver([entry, { ...entry, id: "different-room" }]);
  assert.equal(ambiguous(entry), null);
  assert.equal(catalogueMapPoints(catalogue.venues, []).length, 5);
  const independentlyKnown = ["Massey Hall", "Horseshoe Tavern", "Roy Thomson Hall", "Danforth Music Hall"].map((name) => ({ name, place: "Toronto, Ontario, Canada" }));
  assert.equal(catalogueMapPoints(independentlyKnown, []).length, 4);
});

const at = Date.parse("2026-10-21T15:00:00Z");
const event = (extra = {}) => ({ id: "tm_event-1", providerEventId: "event-1", providerVenueId: "venue-1",
  source: "ticketmaster", createdBy: "import", venue: "Trusted provider room", place: "Ferndale, Michigan, United States Of America",
  venueCity: "Ferndale", venueRegion: "MI", venueCountry: "United States Of America", venueCountryCode: "US",
  lat: 42.459561, lng: -83.133209, ticketUrl: "https://www.ticketmaster.com/event/event-1", ...extra });
const providerOptions = (events = [event()], extra = {}) => ({ providerEvents: events, providerFetchedAt: at, now: at, ...extra });
const providerRoom = (extra = {}) => ({ id: "existing-app-venue", name: event().venue, place: event().place,
  source: "ticketmaster", providerVenueId: "venue-1", ...extra });

test("only a fresh trusted first-party Ticketmaster event witness supplies provider coordinates", () => {
  const row = Object.freeze(providerRoom({ lat: 1, lng: 2, coord: Object.freeze({ lat: 999, lng: 999 }), mapNumber: 88 }));
  assert.equal(createCatalogueMapResolver([])(row), null);
  const point = createCatalogueMapResolver([], providerOptions())(row);
  assert.deepEqual(point.coord, { lat: 42.459561, lng: -83.133209 });
  assert.equal(point.id, row.id);
  assert.equal(point.mapNumber, 88);
  assert.equal(point.coordinateProvenance.basis, "provider-event-witness");
  assert.equal(point.coordinateProvenance.perRecordVerified, false);
  assert.equal(point.coordinateProvenance.license, undefined);
  assert.equal(point.coordinateProvenance.providerVenueId, "venue-1");
  assert.equal(point.coordinateProvenance.expiresAt, "2026-10-21T16:00:00.000Z");
  assert.match(point.coordinateProvenance.attribution, /Ticketmaster/u);
  assert.deepEqual(row.coord, { lat: 999, lng: 999 });
});

test("provider flags, missing identities, city precision and malformed witness points cannot create eligibility", () => {
  for (const changed of [
    { createdBy: "member" }, { source: "bandsintown" }, { source: "google" },
    { id: "not-the-provider-event" }, { providerEventId: null }, { providerVenueId: null },
    { venueCity: null }, { venueCountryCode: null }, { venueCity: "London" },
    { venueCountryCode: "CA" }, { venueRegion: "Kansas" }, { coordinatePrecision: "city" },
    { lat: null }, { lat: 100 }, { lat: 0, lng: 0 }, { coordinateProvenance: { source: "Google" } },
  ]) assert.equal(createCatalogueMapResolver([], providerOptions([event(changed)]))(providerRoom()), null, JSON.stringify(changed));
  for (const changed of [
    { source: "bandsintown" }, { providerVenueId: "unregistered" }, { name: "Another provider room" },
    { place: "London, England, United Kingdom" }, { venueCity: "London" }, { venueCountryCode: "CA" },
    { providerEventId: "not-in-trusted-feed" },
  ]) assert.equal(createCatalogueMapResolver([], providerOptions())(providerRoom(changed)), null, JSON.stringify(changed));
});

test("conflicting witnesses fail closed without picking a first event; identical witnesses remain usable", () => {
  const second = event({ id: "tm_event-2", providerEventId: "event-2" });
  assert.ok(createCatalogueMapResolver([], providerOptions([event(), second]))(providerRoom({ providerEventId: "event-2" })));
  for (const changed of [{ lat: 43 }, { place: "Toronto, Ontario, Canada", venueCity: "Toronto", venueRegion: "ON", venueCountry: "Canada", venueCountryCode: "CA" }]) {
    assert.equal(createCatalogueMapResolver([], providerOptions([event(), { ...second, ...changed }, event()]))(providerRoom()), null);
  }
});

test("five actual source name-variant groups resolve only their exact witnessed aliases", () => {
  const groups = [
    ["KovZpZA1l17A", ["GECU Arena at Don Haskins Center", "GECU Arena at the Don Haskins Center", "Don Haskins Center"], "El Paso", "Texas", "TX", "United States Of America", "US", 31.77787244, -106.5053346],
    ["KovZpZAdE1eA", ["Duke Energy Center for the Arts - Mahaffey Theater", "Mahaffey Theater"], "St Petersburg", "Florida", "FL", "United States Of America", "US", 27.767075, -82.632401],
    ["KovZpa3aIe", ["Fox Cities P.A.C.", "Fox Cities PAC"], "Appleton", "Wisconsin", "WI", "United States Of America", "US", 44.262557, -88.411785],
    ["ZFr9jZeA7F", ["Riverside Theater - WI", "Riverside Theatre - WI"], "Milwaukee", "Wisconsin", "WI", "United States Of America", "US", 43.036999, -87.916901],
    ["KovZpZAkE1lA", ["The Auditorium", "Thunder Bay Community Auditorium"], "Thunder Bay", "Ontario", "ON", "Canada", "CA", 48.4221265, -89.2441099],
  ];
  for (const [providerVenueId, names, venueCity, regionName, venueRegion, venueCountry, venueCountryCode, lat, lng] of groups) {
    const witnesses = names.map((venue, index) => event({ id: `tm_alias-${index}`, providerEventId: `alias-${index}`, providerVenueId,
      venue, place: `${venueCity}, ${regionName}, ${venueCountry}`, venueCity, venueRegion, venueCountry, venueCountryCode, lat, lng }));
    const resolve = createCatalogueMapResolver([], providerOptions(witnesses));
    for (const witness of witnesses) assert.deepEqual(resolve(witness)?.coord, { lat, lng });
    assert.equal(resolve({ ...witnesses[0], venue: `${names[0]} Annex` }), null);
    assert.equal(resolve({ ...witnesses[0], providerVenueId: providerVenueId.toLowerCase() }), null);
  }
});

test("a trusted secondary event witness can locate its qualified catalogue card without changing that card identity", () => {
  const witness = { ...event(), mapCoordinateInput: "event" };
  const row = { id: "authored-card-id", name: witness.venue, place: witness.place, capacity: 1234,
    providerIdentities: ["provider:ticketmaster:venue-1"], mapCoordinateCandidates: [witness] };
  const resolve = createCatalogueMapResolver([], providerOptions());
  const point = resolve(row);
  assert.equal(point?.id, row.id);
  assert.equal(point?.capacity, 1234);
  assert.equal(point?.source, undefined);
  assert.deepEqual(point?.coord, { lat: 42.459561, lng: -83.133209 });
  assert.equal(point?.coordinateProvenance.basis, "provider-event-witness");
  assert.equal(resolve({ ...row, name: "Different authored room" }), null);
  assert.equal(resolve({ ...row, place: "London, England, United Kingdom" }), null);
  assert.equal(resolve({ ...row, providerIdentities: ["provider:ticketmaster:other"] }), null);
  assert.equal(resolve({ ...row, mapCoordinateCandidates: [{ ...witness, mapCoordinateInput: "index" }] }), null);
  assert.equal(createCatalogueMapResolver([], providerOptions([]))(row), null);
  const other = event({ id: "tm_other-event", providerEventId: "other-event", providerVenueId: "other-venue", lat: 43 });
  const ambiguous = createCatalogueMapResolver([], providerOptions([event(), other]));
  assert.equal(ambiguous({ ...row, providerIdentities: [...row.providerIdentities, "provider:ticketmaster:other-venue"],
    mapCoordinateCandidates: [witness, { ...other, mapCoordinateInput: "event" }] }), null);
});

test("provider session witnesses require a valid, nonfuture retrieval time and expire after one hour", () => {
  for (const providerFetchedAt of [undefined, "invalid", at + 1, at - TICKETMASTER_WITNESS_MAX_AGE_MS - 1]) {
    assert.equal(createCatalogueMapResolver([], providerOptions([event()], { providerFetchedAt }))(providerRoom()), null);
  }
  assert.ok(createCatalogueMapResolver([], providerOptions([event()], { providerFetchedAt: new Date(at).toISOString() }))(providerRoom()));
  const point = createCatalogueMapResolver([], providerOptions([event({ ticketUrl: "https://ticketmaster.com.attacker.test/event/1" })]))(providerRoom());
  assert.equal(point.coordinateProvenance.sourceUrl, "https://www.ticketmaster.com/");
  const independent = createCatalogueMapResolver(catalogue.venues, providerOptions())({ name: "First Avenue", place: "Minneapolis, Minnesota, United States", source: "bandsintown", providerVenueId: "other" });
  assert.equal(independent.coordinateProvenance.source, "MusicBrainz");
  let current = at;
  const memoized = createCatalogueMapResolver([], providerOptions([event()], { now: () => current }));
  assert.ok(memoized(providerRoom()));
  current += TICKETMASTER_WITNESS_MAX_AGE_MS + 1;
  assert.equal(memoized(providerRoom()), null);
});

test("trusted provider locality preserves international region-code pairs and comma-bearing city names", () => {
  for (const local of [
    { place: "Paris, Idf, France", venueCity: "Paris", venueRegion: "75", venueCountry: "France", venueCountryCode: "FR" },
    { place: "Ciudad de México, Ciudad de México, Mexico", venueCity: "Ciudad de México", venueRegion: "CDMX", venueCountry: "Mexico", venueCountryCode: "MX", lat: 19.4, lng: -99.1 },
    { place: "Monterrey, Nuevo León, Mexico", venueCity: "Monterrey", venueRegion: "NL", venueCountry: "Mexico", venueCountryCode: "MX", lat: 25.7, lng: -100.3 },
    { place: "Mayo, Co. Mayo, Ireland", venueCity: "Mayo", venueRegion: "MO", venueCountry: "Ireland", venueCountryCode: "IE" },
    { place: "Newcastle upon Tyne, NE1 2PQ, Great Britain", venueCity: "Newcastle upon Tyne, NE1 2PQ", venueRegion: null, venueCountry: "Great Britain", venueCountryCode: "GB" },
  ]) {
    const witness = event(local);
    const resolve = createCatalogueMapResolver([], providerOptions([witness]));
    assert.ok(resolve(witness));
    assert.equal(resolve({ ...witness, venueCountryCode: "CA" }), null);
  }
});

test("a known provider display label can use the exact region code paired with its source name", () => {
  const witness = event({ venue: "Berry Showgrounds", providerVenueId: "KovZ917A-EJ", place: "Berry, New South Wales, Australia",
    venueCity: "Berry", venueRegion: "NSW", venueCountry: "Australia", venueCountryCode: "AU", lat: -34.779316, lng: 150.69489 });
  const resolve = createCatalogueMapResolver([], providerOptions([witness]));
  const row = { ...witness, id: "existing-venue-card", name: witness.venue, place: "Berry, NSW, Australia" };
  assert.deepEqual(resolve(row)?.coord, { lat: -34.779316, lng: 150.69489 });
  assert.equal(resolve({ ...row, place: "Berry, QLD, Australia", venueRegion: "QLD" }), null);
  assert.equal(resolve({ ...row, place: "Berry, NSW, Canada", venueCountryCode: "CA" }), null);
});

const missingIdentityEvent = (witness, extra = {}) => ({
  id: "preserved-outer-card", source: "ticketmaster", createdBy: "import", mapCoordinateInput: "event",
  providerEventId: null, providerVenueId: null, providerIdentities: [], name: witness.venue.trim(), venue: witness.venue,
  place: witness.place, venueCity: witness.venueCity, venueRegion: witness.venueRegion,
  venueCountry: witness.venueCountry, lat: witness.lat, lng: witness.lng, capacity: 1234, ...extra,
});

test("three actual missing-ID imports reconcile only an exact qualified witness and agreeing point", () => {
  const cases = [
    { venue: "Canadian Tire Centre", providerVenueId: "KovZpZA7dnJA", providerEventId: "1Ad7Z_kGkm1Ff1t",
      place: "Kanata, Ontario, Canada", venueCity: "Kanata", venueRegion: "ON", venueCountry: "Canada", venueCountryCode: "CA",
      lat: 45.2965202, lng: -75.9271956, row: { venueRegion: "Ontario" } },
    { venue: " Great Hall, Auckland Town Hall", providerVenueId: "KovZpZAaF6lA", providerEventId: "1A0Zk36GketUsXA",
      place: "Auckland, New Zealand, New Zealand", venueCity: "Auckland", venueRegion: "NZ", venueCountry: "New Zealand", venueCountryCode: "NZ",
      lat: -36.852853, lng: 174.763347, row: { venueRegion: "New Zealand" } },
    { venue: "Intuit Dome", providerVenueId: "KovZ917Acq0", providerEventId: "vv1AaZkogGkd5zy4D",
      place: "Inglewood, California, United States Of America", venueCity: "Inglewood", venueRegion: "CA", venueCountry: "United States Of America", venueCountryCode: "US",
      lat: 33.94432, lng: -118.34285, row: { place: "Inglewood, California, United States", venueRegion: "California", venueCountry: "United States" } },
  ];
  for (const { row: overrides, ...metadata } of cases) {
    const witness = event({ ...metadata, id: `tm_${metadata.providerEventId}` });
    const row = Object.freeze(missingIdentityEvent(witness, overrides));
    const result = createCatalogueMapResolver([], providerOptions([witness]))(row);
    assert.deepEqual(result?.coord, { lat: row.lat, lng: row.lng });
    assert.equal(result?.id, row.id);
    assert.equal(result?.name, row.name);
    assert.equal(result?.capacity, row.capacity);
    assert.equal(result?.providerVenueId, null);
    assert.equal(result?.providerEventId, null);
    assert.equal(result?.source, row.source);
    assert.equal(result?.coordinateProvenance.providerVenueId, witness.providerVenueId);
    assert.equal(result?.coordinateProvenance.providerEventId, witness.providerEventId);
    assert.equal(result?.coordinateProvenance.basis, "provider-event-witness");
    assert.equal(row.coordinateProvenance, undefined);
  }
});

test("missing-ID reconciliation never repairs mismatches, index assertions, Google evidence or stale witnesses", () => {
  const witness = event(), row = missingIdentityEvent(witness);
  const resolve = createCatalogueMapResolver([], providerOptions());
  for (const changed of [
    { lat: row.lat + .000001 }, { lat: null }, { lat: 0, lng: 0 }, { lat: 999 },
    { name: "Trusted provider room Annex" }, { venue: "Contradictory original venue" }, { place: "Ferndale" }, { venueCity: "London" }, { venueRegion: "CA" }, { venueCountryCode: "CA" },
    { source: "bandsintown" }, { createdBy: "member" }, { mapCoordinateInput: "index" }, { mapCoordinateInput: undefined },
    { providerVenueId: 123 }, { venue_provider_id: "asserted-other" }, { providerEventId: "not-the-witness" },
    { providerIdentities: ["provider:ticketmaster:venue-1", "provider:ticketmaster:other"] },
    { coordinatePrecision: "city" }, { coordinateProvenance: { source: "Google" } }, { coord: { source: "Google" } },
  ]) assert.equal(resolve({ ...row, ...changed }), null, JSON.stringify(changed));
  for (const providerFetchedAt of [undefined, at + 1, at - TICKETMASTER_WITNESS_MAX_AGE_MS - 1]) {
    assert.equal(createCatalogueMapResolver([], providerOptions([witness], { providerFetchedAt }))(row), null);
  }
  let current = at;
  const expiring = createCatalogueMapResolver([], providerOptions([witness], { now: () => current }));
  assert.ok(expiring(row));
  current += TICKETMASTER_WITNESS_MAX_AGE_MS + 1;
  assert.equal(expiring(row), null);
});

test("missing-ID reconciliation rejects multiple case-sensitive provider identities and inconsistent witnesses", () => {
  const first = event(), row = missingIdentityEvent(first);
  const other = event({ id: "tm_other", providerEventId: "other", providerVenueId: "Venue-1" });
  const conflicting = event({ id: "tm_conflict", providerEventId: "conflict", lat: first.lat + .001 });
  for (const witnesses of [[first, other], [other, first], [first, conflicting], [first, other, { ...other, lat: 40 }]]) {
    assert.equal(createCatalogueMapResolver([], providerOptions(witnesses))(row), null);
  }
  const otherCity = { ...other, venueCity: "Toronto", venueRegion: "ON", venueCountry: "Canada", venueCountryCode: "CA", place: "Toronto, Ontario, Canada" };
  assert.ok(createCatalogueMapResolver([], providerOptions([first, otherCity]))(row), "a different qualified locality is not a name-only collision");
});

const pendingCatalogueRow = (extra = {}) => ({ id: "trusted-pending-room", key: "trusted-pending-room", name: event().venue,
  place: event().place, lat: 1, lng: 2, capacity: 900, coordinateEligibility: "uncertain", ...extra });

test("a registered uncertain catalogue identity can use a unique fresh provider point without relabelling its old point", () => {
  const registered = Object.freeze(pendingCatalogueRow());
  const row = Object.freeze({ ...registered, mapCoordinateInput: "catalogue", mapNumber: 88 });
  const result = createCatalogueMapResolver([registered], providerOptions())(row);
  assert.deepEqual(result?.coord, { lat: event().lat, lng: event().lng });
  assert.equal(result?.id, row.id);
  assert.equal(result?.capacity, 900);
  assert.equal(result?.mapNumber, 88);
  assert.equal(result?.source, undefined);
  assert.equal(result?.providerVenueId, undefined);
  assert.equal(result?.coordinateProvenance.providerVenueId, "venue-1");
  assert.equal(result?.coordinateProvenance.basis, "provider-event-witness");
  assert.equal(result?.coordinateProvenance.perRecordVerified, false);
  assert.equal(result?.coordinateProvenance.license, undefined);
  assert.equal(registered.lat, 1);
  assert.equal(registered.coordinateProvenance, undefined);
  assert.equal(createCatalogueMapResolver([], providerOptions())(row), null);
});

test("only existing explicit catalogue name aliases match source witnesses", () => {
  const registered = pendingCatalogueRow({ id: "history", key: "history", name: "History", place: "Toronto, Ontario, Canada" });
  const witness = event({ venue: "History Toronto", place: registered.place, venueCity: "Toronto", venueRegion: "ON", venueCountry: "Canada", venueCountryCode: "CA" });
  const resolve = createCatalogueMapResolver([registered], providerOptions([witness]));
  assert.ok(resolve(registered));
  assert.equal(resolve({ ...registered, name: "History Toronto" }), null, "caller aliases cannot replace the registered catalogue identity");
  assert.equal(createCatalogueMapResolver([registered], providerOptions([{ ...witness, venue: "History Toronto Annex" }]))(registered), null);
});

test("curated provider lookup rejects spoofed catalogue assertions, unqualified rows, collisions and stale points", () => {
  const registered = pendingCatalogueRow(), resolve = createCatalogueMapResolver([registered], providerOptions());
  for (const changed of [
    { id: "invented-card" }, { key: "other-key" }, { coordinateEligibility: "eligible" }, { name: "Another room" }, { place: "Ferndale" },
    { mapCoordinateInput: "index" }, { source: "MusicBrainz" }, { source: "Google" }, { providerVenueId: "venue-1" },
    { sourceId: "asserted" }, { sourceUrl: "https://example.org" }, { coordinateSource: "MusicBrainz" }, { provider: "MusicBrainz" }, { musicbrainzPlaceId: "asserted" }, { wikidataId: "Q123" },
    { coordinateProvenance: { source: "Ticketmaster" } }, { coordinatePrecision: "city" },
    { countryCode: "CA" }, { region: "California" }, { providerIdentities: ["provider:ticketmaster:venue-1", "provider:ticketmaster:other"] },
  ]) assert.equal(resolve({ ...registered, ...changed }), null, JSON.stringify(changed));
  const other = event({ id: "tm_other", providerEventId: "other", providerVenueId: "other-venue" });
  assert.equal(createCatalogueMapResolver([registered], providerOptions([event(), other]))(registered), null);
  assert.equal(createCatalogueMapResolver([registered], providerOptions([event(), { ...other, providerVenueId: "venue-1", lat: 40 }]))(registered), null);
  assert.equal(createCatalogueMapResolver([registered, { ...registered, id: "duplicate-identity" }], providerOptions())(registered), null);
  assert.equal(createCatalogueMapResolver([registered], providerOptions([event()], { providerFetchedAt: at - TICKETMASTER_WITNESS_MAX_AGE_MS - 1 }))(registered), null);
});

test("six actual provider points with gross locality contradictions never become map witnesses", () => {
  const cases = [
    ["rZ7HnEZ171A7V", "Albatross", "Jacksonville", "FL", "Florida", "United States Of America", "US", -81.656423, 30.326208],
    ["rZ7HnEZ17_taS", " Crossroads Christian Church", "Corona", "CA", "California", "United States Of America", "US", 33.8511, 117.55648],
    ["KovZpZA67EaA", "Edgemen", "Clinton Twp", "MI", "Michigan", "United States Of America", "US", -40.354117, 175.609856],
    ["Z198xZQpZeF7", "Klub Proxima", "Warsaw", "Mazowieckie", "Mazowieckie", "Poland", "PL", 1, 1],
    ["KovZ917ARm4", "Double Whammy", "Auckland", "NZ", "New Zealand", "New Zealand", "NZ", 36.85769303, 174.76013853],
    ["KovZ917AVVr", "Estadio River Plate", "Buenos Aires Argentina", "QRO", "QRO", "Mexico", "MX", -34.545358, -58.449662],
  ];
  for (const [providerVenueId, venue, venueCity, venueRegion, regionLabel, venueCountry, venueCountryCode, lat, lng] of cases) {
    const witness = event({ providerVenueId, venue, venueCity, venueRegion, venueCountry, venueCountryCode, lat, lng,
      place: `${venueCity}, ${regionLabel}, ${venueCountry}` });
    const resolve = createCatalogueMapResolver([], providerOptions([witness]));
    assert.equal(resolve(providerRoom({ name: venue.trim(), place: witness.place, providerVenueId })), null, providerVenueId);
    assert.equal(resolve(missingIdentityEvent(witness)), null, `ID-free import: ${providerVenueId}`);
  }
});

test("context-rejected and missing-point identities still prevent an ambiguous qualified donor lookup", () => {
  const registered = pendingCatalogueRow(), first = event();
  for (const changed of [{ lat: 1, lng: 1 }, { lat: null, lng: null }]) {
    const other = event({ id: "tm_other", providerEventId: "other", providerVenueId: "other-venue", ...changed });
    const resolve = createCatalogueMapResolver([registered], providerOptions([first, other]));
    assert.ok(resolve(providerRoom()), "the direct valid namespaced witness remains usable");
    assert.equal(resolve(registered), null);
    assert.equal(resolve(missingIdentityEvent(first)), null);
  }
});

test("the reviewed wrong Roxy provider tuple is withheld rather than silently snapped to an independent point", () => {
  const wrong = event({ providerVenueId: "ZFr9jZeA6a", venue: "Roxy Theatre-CA", place: "West Hollywood, California, United States Of America",
    venueCity: "West Hollywood", venueRegion: "CA", lat: 34.0942, lng: -118.3815 });
  const resolve = createCatalogueMapResolver(catalogue.venues, providerOptions([wrong]));
  assert.equal(resolve(wrong), null);
  assert.equal(resolve({ ...wrong, name: "The Roxy Theatre", venue: "The Roxy Theatre" }), null,
    "a renamed provider row cannot hide its reviewed bad source point through an independent override");
  assert.equal(resolve({ ...wrong, name: "The Roxy Theatre", coord: { lat: 34.090805555555555, lng: -118.388 } }), null,
    "a mixed normalized coordinate cannot hide the reviewed bad raw source tuple");
  assert.equal(resolve({ ...wrong, name: "The Roxy Theatre", venue_provider_id: "other-venue" }), null,
    "contradictory provider IDs cannot hide a reviewed source identity");
  const corrected = { ...wrong, lat: 34.090805555555555, lng: -118.388 };
  const result = createCatalogueMapResolver(catalogue.venues, providerOptions([corrected]))(corrected);
  assert.deepEqual(result?.coord, { lat: corrected.lat, lng: corrected.lng });
  assert.equal(result?.coordinateProvenance.basis, "provider-event-witness");
});

test("three missing-point Canadian import cards use unique eligible catalogue points through qualified exact aliases", () => {
  const cases = [
    ["centennial concert hall", "Centennial Concert Hall", "Winnipeg", "MB", "Z6r9jZd1ae"],
    ["tcu place", "TCU Place", "Saskatoon", "SK", "ZFr9jZAd1d"],
    ["lee’s palace", "Lee's Palace", "Toronto", "ON", "ZFr9jZ7e7d"],
  ];
  for (const [catalogueId, name, city, province, providerVenueId] of cases) {
    const registered = catalogue.venues.find((row) => row.id === catalogueId);
    assert.ok(registered);
    const row = Object.freeze({ id: `provider:ticketmaster:${providerVenueId}`, name, source: "ticketmaster", providerVenueId,
      createdBy: "import", mapCoordinateInput: "event", place: `${city}, ${province}, CA`, venueCity: city, venueRegion: province,
      venueCountry: "Canada", venueCountryCode: "CA", lat: 0, lng: 0, coord: Object.freeze({ lat: 0, lng: 0 }), capacity: 900 });
    const resolve = createCatalogueMapResolver(catalogue.venues), result = resolve(row);
    assert.deepEqual(result?.coord, registered.mapCoordinate);
    assert.equal(result?.coordinateProvenance.source, "MusicBrainz");
    assert.equal(result?.coordinateProvenance.basis, "ingestion-batch");
    assert.equal(result?.coordinateProvenance.importKey, registered.coordinateProvenance.importKey);
    assert.equal(result?.id, row.id);
    assert.equal(result?.providerVenueId, providerVenueId);
    assert.equal(result?.source, row.source);
    assert.equal(result?.capacity, 900);
    assert.equal(row.lat, 0);
    for (const changed of [
      { place: `${city}, ${province}, United States`, venueCountry: "United States", venueCountryCode: "US" },
      { venueRegion: "Alberta" }, { venueCity: "Another city" }, { name: `${name} Annex` },
      { source: "Google" }, { coordinatePrecision: "city" }, { musicbrainzPlaceId: "invented-record" },
      { coordinateProvenance: { source: "MusicBrainz", sourceId: "invented-record" } },
      { mapCoordinateInput: "index" }, { createdBy: "member" }, { lat: 45, lng: -75, coord: { lat: 45, lng: -75 } },
    ]) assert.equal(resolve({ ...row, ...changed }), null, `${name}: ${JSON.stringify(changed)}`);
    assert.equal(createCatalogueMapResolver([registered, { ...registered, id: "ambiguous-static-room" }])(row), null);
    assert.equal(createCatalogueMapResolver([{ ...registered, coordinateEligibility: "uncertain" }])(row), null);
  }
});

test("the new Canadian alias path withholds McPherson's missing-point provider card while its source tuples disagree", () => {
  const registered = catalogue.venues.find((row) => row.id === "mcpherson playhouse");
  const row = { id: "provider:ticketmaster:ZFr9jZkada", name: "McPherson Playhouse", source: "ticketmaster", providerVenueId: "ZFr9jZkada",
    createdBy: "import", mapCoordinateInput: "event", place: "Victoria, BC, Canada", venueCity: "Victoria", venueRegion: "BC",
    venueCountry: "Canada", venueCountryCode: "CA", lat: 0, lng: 0 };
  const resolve = createCatalogueMapResolver(catalogue.venues);
  assert.equal(resolve(row), null);
  assert.deepEqual(resolve(registered)?.coord, { lat: 48.428834, lng: -123.366627 });
  assert.equal(resolve(registered)?.coordinateProvenance.basis, "ingestion-batch");
});
