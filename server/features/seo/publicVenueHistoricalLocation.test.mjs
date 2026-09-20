import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "pit-venue-history-location-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("../../db.js");
const { createPublicDocumentRepository } = await import("./publicDocumentRepository.js");
const { createPublicDocumentProjector } = await import("./publicDocumentProjection.js");
const { renderPublicDocument } = await import("./publicDocumentRenderer.js");
const { hasSubstantiveVenueGuide } = await import("../../venueFacts.js");
const repository = createPublicDocumentRepository(db);
const projector = createPublicDocumentProjector({ database: db });
const NOW = Date.parse("2030-09-09T15:00:00Z");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function addEvent(id, overrides = {}) {
  const event = {
    id, artist: "A Public Band", venue: "Scotiabank Arena", place: "Toronto",
    date: "2029-01-01", updated_at: 100, release_at: 0, source: "ticketmaster",
    venue_provider_id: "historical-toronto", venue_city: "Toronto", venue_region: "Ontario",
    venue_country: "Canada", venue_country_code: "CA", owner_id: null,
    provider_active: 0, music_qualified: 1, event_kind: "concert", event_name: "A Public Band Live",
    ...overrides,
  };
  const columns = Object.keys(event);
  db.prepare(`INSERT INTO tour_dates (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(event));
}

test("withdrawn historic music dates retain provider venue locality without becoming upcoming shows", () => {
  addEvent("history-toronto", { venue_address_line1: "40 Bay Street", venue_postal_code: "M5J 2X2", lat: 43.6435, lng: -79.3791 });
  addEvent("other-namespace", { source: "eventbrite", venue_city: "Ottawa", updated_at: 200,
    venue_address_line1: "Different provider address", lat: 45.4, lng: -75.7 });
  addEvent("other-provider-room", { venue_provider_id: "another-room", venue_city: "Halifax", updated_at: 300 });
  // Slug-equivalent provider identifiers must still satisfy the exact stored ID.
  addEvent("provider-slug-collision", { venue_provider_id: "historical toronto", venue_city: "Montreal", updated_at: 400 });
  const raw = repository.readVenue({ name: "Scotiabank Arena", providerVenueId: "historical-toronto", source: "ticketmaster", at: NOW });
  assert.equal(raw.venue.place, "Toronto, Ontario, Canada");
  assert.deepEqual(raw.events, []);
  assert.deepEqual(raw.posts, []);
  const document = projector.venue(raw);
  assert.equal(document.venue.place, "Toronto, Ontario, Canada");
  assert.ok(document.venue.capacity > 0);
  assert.equal(document.venue.guideLocationVerified, true);
  assert.equal(hasSubstantiveVenueGuide(document.venue), true);
  assert.deepEqual(document.events, []);
  assert.equal(document.venue.address.streetAddress, "40 Bay Street");
  assert.equal(document.venue.address.postalCode, "M5J 2X2");
  assert.deepEqual(document.venue.coord, { lat: 43.6435, lng: -79.3791 });
  const schema = document.jsonLd.find((node) => node["@type"] === "MusicVenue");
  assert.deepEqual(schema.address, document.venue.address);
  assert.equal(schema.geo.latitude, 43.6435);
  assert.match(renderPublicDocument(document), /40 Bay Street/);
  assert.doesNotMatch(renderPublicDocument(document), /Different provider address/);
});

test("private, non-music and withdrawn future rows cannot overwrite a public historical venue location", () => {
  for (const id of ["venue-active-owner", "venue-banned-owner"]) {
    q.insertUser.run(id, `${id}@example.test`, id, id, "hash", "fan", null, null, null, "VE", "#111111", 1);
  }
  db.prepare("UPDATE users SET is_banned=1 WHERE id='venue-banned-owner'").run();
  const base = { venue_provider_id: "history-visibility", venue_city: "Toronto",
    venue_address_line1: "Known Public Address", lat: 43.65, lng: -79.38 };
  addEvent("visible-history", base);
  const hidden = [
    { id: "scheduled-history", owner_id: "venue-active-owner", release_at: NOW + 1 },
    { id: "banned-history", owner_id: "venue-banned-owner" },
    { id: "unqualified-history", music_qualified: 0 },
    { id: "sports-history", event_kind: "sports" },
    { id: "addon-history", event_name: "VIP Upgrade" },
    { id: "invalid-calendar-history", date: "2029-02-30" },
    { id: "withdrawn-future", date: "2031-01-01", provider_active: 0 },
  ];
  for (const [index, row] of hidden.entries()) addEvent(row.id, { ...base, venue_city: "Halifax",
    venue_address_line1: "Withheld address", lat: 44.65, lng: -63.57, updated_at: 1_000 + index, ...row });
  const raw = repository.readVenue({ name: "Scotiabank Arena", providerVenueId: "history-visibility", source: "ticketmaster", at: NOW });
  assert.equal(raw.venue.place, "Toronto, Ontario, Canada");
  assert.deepEqual(raw.events, []);
  assert.equal(projector.venue(raw).venue.address.streetAddress, "Known Public Address");
  assert.deepEqual(projector.venue(raw).venue.coord, { lat: 43.65, lng: -79.38 });

  addEvent("latest-public-history", { ...base, venue_city: "Ottawa", updated_at: 500 });
  const changed = repository.readVenue({ name: "Scotiabank Arena", providerVenueId: "history-visibility", source: "ticketmaster", at: NOW });
  assert.equal(changed.venue.place, "Ottawa, Ontario, Canada");
  assert.equal(projector.venue(changed).venue.capacity, null);
});

test("name-only historic locality prevents same-name and unknown rooms from inheriting indexable curated guides", () => {
  addEvent("name-wrong-city", { venue_provider_id: null, source: null, venue_city: "Halifax", venue_region: "Nova Scotia", updated_at: 5_000 });
  const raw = repository.readVenue({ name: "Scotiabank Arena", at: NOW });
  assert.equal(raw.venue.place, "Halifax, Nova Scotia, Canada");
  assert.deepEqual(raw.events, []);
  const wrongRoom = projector.venue(raw);
  assert.equal(wrongRoom.venue.capacity, null);
  assert.equal(wrongRoom.venue.guideLocationVerified, false);
  assert.equal(hasSubstantiveVenueGuide(wrongRoom.venue), false);

  const unknownRoom = projector.venue({ venue: { name: "Scotiabank Arena" }, posts: [], events: [] });
  assert.equal(unknownRoom.venue.guideLocationVerified, false);
  assert.equal(hasSubstantiveVenueGuide(unknownRoom.venue), false);
});

test("historical locality reads use existing ordered venue indexes and return at most one row", () => {
  const locationQueries = [];
  createPublicDocumentRepository({
    function: db.function.bind(db),
    prepare(sql) {
      if (sql.startsWith("SELECT td.place,td.venue_city,td.venue_region")) locationQueries.push(sql);
      return db.prepare(sql);
    },
  });
  assert.equal(locationQueries.length, 2);
  for (const sql of locationQueries) {
    assert.match(sql, /ORDER BY td\.updated_at DESC,td\.id DESC LIMIT 1$/);
    const provider = sql.includes("pit_venue_public_slug");
    const args = provider
      ? ["ticketmaster-historical-toronto", "ticketmaster", "historical-toronto", NOW, "2030-09-09"]
      : ["scotiabank-arena", "Scotiabank Arena", NOW, "2030-09-09"];
    const detail = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((row) => row.detail).join("\n");
    assert.ok(detail.includes(provider ? "idx_tourdates_provider_venue_public_slug" : "idx_tourdates_venue_public_slug"), detail);
    assert.doesNotMatch(detail, /SCAN td|USE TEMP B-TREE FOR ORDER BY/);
  }
});

test("historical venue facts exclude held, removed and privately authored artist dates", () => {
  const venue = "Identity Protected History Hall";
  const providerId = "identity-history-room";
  addEvent("independent-location", { venue, venue_provider_id: providerId,
    venue_address_line1: "10 Public Hall Way", lat: 43.7, lng: -79.4 });
  for (const [index, state] of ["pending", "rejected", "removed", "only_me", "members"].entries()) {
    const owner = `venue-history-owner-${state}`;
    const artist = `venue-history-artist-${state}`;
    q.insertUser.run(owner, `${owner}@example.test`, owner, owner, "hash", "artist", null, null, null, "VH", "#111111", 1);
    db.prepare("INSERT INTO artists (norm,name,source,public_slug,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(artist, artist, "artist-created", artist, 1, 1);
    db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,removed,identity_review_status) VALUES (?,?,?,?)")
      .run(artist, owner, state === "removed" ? 1 : 0, ["pending", "rejected"].includes(state) ? state : "clear");
    if (["only_me", "members"].includes(state)) db.prepare("UPDATE users SET profile_audience=? WHERE id=?").run(state, owner);
    addEvent(`withheld-location-${state}`, { venue, venue_provider_id: providerId, artist, artist_key: artist,
      owner_id: owner, updated_at: 10_000 + index, venue_city: "Ottawa", venue_address_line1: "Hidden Artist Location",
      lat: 45.4, lng: -75.7 });
  }
  const raw = repository.readVenue({ name: venue, providerVenueId: providerId, source: "ticketmaster", at: NOW });
  const document = projector.venue(raw);
  assert.equal(document.venue.address.streetAddress, "10 Public Hall Way");
  assert.deepEqual(document.venue.coord, { lat: 43.7, lng: -79.4 });
  assert.doesNotMatch(renderPublicDocument(document), /Hidden Artist Location|Ottawa/);
  assert.deepEqual(document.events, []);
});

test("historical coordinates remain unknown for missing or invalid stored values", () => {
  for (const [index, [lat, lng]] of [[null, null], ["", ""], [100, -79], [43, 181], ["not-a-latitude", -79]].entries()) {
    const venue = `Unknown Coordinates Hall ${index}`;
    const providerId = `unknown-coordinate-history-${index}`;
    addEvent(providerId, { venue, venue_provider_id: providerId, lat, lng });
    const document = projector.venue(repository.readVenue({ name: venue, providerVenueId: providerId, source: "ticketmaster", at: NOW }));
    assert.equal(document.venue.coord, null, `coordinates ${lat},${lng} are not verified`);
    assert.equal(document.jsonLd.find((node) => node["@type"] === "MusicVenue").geo, undefined);
  }
});

test("a current city cannot borrow a conflicting historical venue address or coordinates", () => {
  const document = projector.venue({
    venue: { name: "A Relocated Hall", place: "Toronto, Ontario, Canada",
      location: { venue_address_line1: "Old Toronto Address", venue_city: "Toronto", venue_country_code: "CA", lat: 43.65, lng: -79.38 } },
    posts: [],
    events: [{ id: "relocated-show", artist: "A Band", venue: "A Relocated Hall", date: "2030-10-01",
      place: "Ottawa, Ontario, Canada" }],
  });
  assert.equal(document.venue.place, "Ottawa, Ontario, Canada");
  assert.equal(document.venue.address, null);
  assert.equal(document.venue.coord, null);
  assert.doesNotMatch(renderPublicDocument(document), /Old Toronto Address/);
});

test("same-city relocations never attach historical coordinates to a different current address", () => {
  for (const changed of [
    { venue_address_line1: "99 New Street" },
    { venue_postal_code: "M5V 9Z9" },
    { venue_region: "Different Region" },
  ]) {
    const document = projector.venue({
      venue: { name: "Same City Relocation Hall", place: "Toronto, Ontario, Canada",
        location: { venue_address_line1: "10 Old Street", venue_city: "Toronto", venue_region: "Ontario",
          venue_country_code: "CA", venue_postal_code: "M5V 1A1", lat: 43.65, lng: -79.38 } },
      posts: [],
      events: [{ id: "moved-show", artist: "A Band", venue: "Same City Relocation Hall", date: "2030-10-01",
        place: "Toronto, Ontario, Canada", venue_address_line1: "10 Old Street", venue_city: "Toronto",
        venue_region: "Ontario", venue_country_code: "CA", venue_postal_code: "M5V 1A1", ...changed }],
    });
    assert.equal(document.venue.coord, null);
    assert.equal(document.jsonLd.find((node) => node["@type"] === "MusicVenue").geo, undefined);
    assert.doesNotMatch(document.venue.guide.actions.find((action) => action.id === "directions")?.url || "", /43\.65|-79\.38/);
  }
});

test("same-named cities in different regions cannot inherit historical address or coordinates", () => {
  const document = projector.venue({
    venue: { name: "Regional Hall", place: "Springfield, Oregon, United States",
      location: { venue_address_line1: "1 Oregon Avenue", venue_city: "Springfield", venue_region: "Oregon",
        venue_country_code: "US", lat: 44.05, lng: -123.02 } },
    posts: [],
    events: [{ id: "regional-show", artist: "A Band", venue: "Regional Hall", date: "2030-10-01",
      place: "Springfield, Illinois, United States" }],
  });
  assert.equal(document.venue.place, "Springfield, Illinois, United States");
  assert.equal(document.venue.address, null);
  assert.equal(document.venue.coord, null);
  assert.doesNotMatch(renderPublicDocument(document), /Oregon Avenue/);
});

test("partial current location evidence cannot borrow a conflicting complete historical address", () => {
  const raw = {
    venue: { name: "Partial Location Hall", place: "Toronto, Ontario, Canada",
      location: { venue_address_line1: "10 Old Street", venue_address_line2: "Old Annex", venue_city: "Toronto",
        venue_region: "Ontario", venue_postal_code: "M1A1A1", venue_country_code: "CA", venue_country: "Canada", lat: 43.65, lng: -79.38 } },
    posts: [],
  };
  const base = { id: "partial-show", artist: "A Band", venue: "Partial Location Hall", date: "2030-10-01", place: "Toronto, Ontario, Canada" };
  for (const changed of [
    { venue_postal_code: "M9Z9Z9" }, { venue_region: "Different Region" },
    { venue_city: "Ottawa" }, { venue_country_code: "US" }, { venue_country: "United States" },
    { lat: 43.8 }, { lat: 43.8, lng: -79.5 }, { lat: 200, lng: -79.38 },
  ]) {
    const document = projector.venue({ ...raw, events: [{ ...base, ...changed }] });
    assert.equal(document.venue.address, null, JSON.stringify(changed));
    assert.deepEqual(document.venue.coord, venueCoordinateForTest(changed), JSON.stringify(changed));
    assert.doesNotMatch(renderPublicDocument(document), /10 Old Street|M1A1A1/);
  }
  const matching = projector.venue({ ...raw, events: [{ ...base, venue_postal_code: "m1a1a1", lat: 43.65, lng: -79.38 }] });
  assert.equal(matching.venue.address.streetAddress, "10 Old Street, Old Annex");
  assert.deepEqual(matching.venue.coord, { lat: 43.65, lng: -79.38 });
});

function venueCoordinateForTest(value) {
  return Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180 ? { lat: value.lat, lng: value.lng } : null;
}

test("venue calendar previews use one bounded extra row and never advertise a preview as the total", () => {
  const venue = "Bounded Preview Hall";
  const providerId = "bounded-preview-hall";
  for (let index = 0; index < 9; index++) addEvent(`preview-${index}`, {
    venue, venue_provider_id: providerId, date: `2030-10-${String(index + 1).padStart(2, "0")}`,
    provider_active: 1,
  });
  const args = { name: venue, providerVenueId: providerId, source: "ticketmaster", at: NOW };
  let document = projector.venue(repository.readVenue(args));
  assert.equal(document.events.length, 8);
  assert.equal(document.eventsHasMore, true);
  assert.match(document.description, /See the next 8 upcoming concerts/);
  assert.match(renderPublicDocument(document), /Upcoming shows preview<\/dt><dd>8\+/);
  assert.match(renderPublicDocument(document), /Showing the next 8 listed concerts/);
  const observedLimits = [];
  const boundedRepository = createPublicDocumentRepository({
    function: db.function.bind(db),
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!sql.startsWith("SELECT td.*,a.norm AS artist_key") || !sql.includes("td.venue_provider_id=?")) return statement;
      return { all(...values) { observedLimits.push(values.at(-1)); return statement.all(...values); } };
    },
  });
  boundedRepository.readVenue(args);
  boundedRepository.readVenue({ ...args, eventLimit: 10_000 });
  assert.deepEqual(observedLimits, [9, 17], "only one row beyond each bounded page is read");
  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id='preview-8'").run();
  document = projector.venue(repository.readVenue(args));
  assert.equal(document.events.length, 8);
  assert.equal(document.eventsHasMore, false);
  assert.match(document.description, /See 8 upcoming concerts/);
  assert.doesNotMatch(renderPublicDocument(document), /Upcoming shows preview|Showing the next/);
});
