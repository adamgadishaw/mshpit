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
  addEvent("history-toronto");
  addEvent("other-namespace", { source: "eventbrite", venue_city: "Ottawa", updated_at: 200 });
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
});

test("private, non-music and withdrawn future rows cannot overwrite a public historical venue location", () => {
  for (const id of ["venue-active-owner", "venue-banned-owner"]) {
    q.insertUser.run(id, `${id}@example.test`, id, id, "hash", "fan", null, null, null, "VE", "#111111", 1);
  }
  db.prepare("UPDATE users SET is_banned=1 WHERE id='venue-banned-owner'").run();
  const base = { venue_provider_id: "history-visibility", venue_city: "Toronto" };
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
  for (const [index, row] of hidden.entries()) addEvent(row.id, { ...base, venue_city: "Halifax", updated_at: 1_000 + index, ...row });
  const raw = repository.readVenue({ name: "Scotiabank Arena", providerVenueId: "history-visibility", source: "ticketmaster", at: NOW });
  assert.equal(raw.venue.place, "Toronto, Ontario, Canada");
  assert.deepEqual(raw.events, []);

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
