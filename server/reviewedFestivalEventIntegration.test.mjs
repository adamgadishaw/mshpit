import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createArtistLiveSummaryService } from "./features/artistArchive/artistLiveSummaryService.js";
import { createPublicDocumentService } from "./features/seo/publicDocuments.js";
import { createShowAttendanceRepository } from "./features/shows/showAttendanceRepository.js";
import { createShowRepository } from "./features/shows/showRepository.js";
import { reconcileReviewedFestivalEvents } from "./reviewedFestivalEventReconciliation.js";
import { visibleTourDateRowsFrom } from "./tourDateVisibilityQuery.js";

const directory = mkdtempSync(join(tmpdir(), "pit-reviewed-festival-"));
process.env.PIT_DATA_DIR = directory;
globalThis.fetch = async () => { throw new Error("No network in this fixture"); };
const { db, q } = await import("./db.js");
const { resolveEntity } = await import("./seo.js");
const { upsertProviderTourDateRows } = await import("./tourdates.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const at = Date.parse("2026-11-19T20:00:00Z");
const id = "tm_G5vIZ_G2gu-Q7";
const partnerId = "G5vIZ_G2gu-Q7";
const caesar = "Daniel Caesar";
const bill = [caesar, "Gorillaz", "Chvrches"];
const venue = "Autódromo Hermanos Rodríguez - Redirect";
const city = "Temple City, California, United States Of America";
const ticket = "https://www.ticketmaster.com.mx/event/fixture-admission";
const stale = {
  id, provider_event_id: partnerId, source: "ticketmaster", event_name: "Corona Capital", artist: caesar,
  artist_key: "daniel caesar", venue, place: city, venue_city: "Temple City", venue_region: "California",
  venue_country: "United States Of America", venue_country_code: "US", venue_provider_id: "bad-venue",
  lat: 34, lng: -118, date: "2026-11-20", event_kind: "festival", event_status: "onsale",
  event_timezone: "America/Los_Angeles", start_local_time: "12:00:00", music_qualified: 1,
  music_evidence: "ticketmaster:classification:music", billed_artists: bill, ticket_url: ticket,
};
const legacy = (...events) => {
  for (const raw of events) {
    const row = { ...raw, billed_artists: JSON.stringify(raw.billed_artists), updated_at: 1 };
    const fields = Object.keys(row);
    db.prepare(`INSERT INTO tour_dates (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...Object.values(row));
  }
};
const read = (eventId = id) => db.prepare("SELECT * FROM tour_dates WHERE id=?").get(eventId);
const artist = (name) => db.prepare("SELECT norm,name FROM artists WHERE name=? COLLATE NOCASE LIMIT 1").get(name);
function addArtist(name) {
  if (artist(name)) return;
  db.prepare(`INSERT INTO artists (norm,name,public_slug,search_key,source,created_at,updated_at)
    VALUES (?,?,?,?, 'fixture',1,1)`).run(name.toLowerCase(), name, name.toLowerCase().replaceAll(" ", "-"), name);
}
test("existing and reimported festival rows fix public event, artist, location and saved show without losing stable IDs or tickets", (t) => {
  t.mock.method(Date, "now", () => at);
  for (const name of [caesar, "Gorillaz", "Jamie xx"]) addArtist(name);
  const caesarIdentity = artist(caesar);
  legacy({ ...stale, artist_key: caesarIdentity.norm },
    { ...stale, id: "tm_1AfZk3_Gkdw1XuQ", provider_event_id: "1AfZk3_Gkdw1XuQ",
      artist: "Gorillaz", artist_key: artist("Gorillaz").norm, event_name: "Individual Banamex Plus Corona Capital 2026",
      place: "México, Ciudad de México, Mexico", venue: "Autodromo Hnos. Rodriguez", venue_city: "México",
      venue_country_code: "MX", venue_provider_id: "right-venue", start_local_time: "14:00:00" },
    { ...stale, id: "tm_edc_control", provider_event_id: "edc_control", event_name: "EDC Mexico",
      artist: "No performer", artist_key: null, billed_artists: [] });
  const initial = read();
  const primary = resolveEntity(`/event/${id}`);
  assert.ok(primary);
  assert.equal(primary.venue, "Autódromo Hermanos Rodríguez");
  assert.equal(primary.ticketUrl, ticket);
  assert.equal(primary.artistKey, null);
  const documents = createPublicDocumentService({ database: db, origin: "https://www.example.test" });
  const document = documents.eventDocument({ id, today: "2026-11-19", at });
  assert.ok(document);
  assert.equal(document.event.place, "Mexico City, Ciudad de México, Mexico");
  assert.ok(document.event.billedArtists.includes("Jamie xx"));
  assert.ok(!document.event.billedArtists.includes(caesar));
  const service = createArtistLiveSummaryService({ database: db, projectDate: (row) => row, clock: () => at });
  assert.equal(service.read({ artist: caesarIdentity }).schedule.total, 0);

  const member = "festival_fixture";
  q.insertUser.run(member, "festival_fixture@example.test", member, member, "fixture-hash", "fan", "Toronto", 43.65, -79.38, "FX", "#123456", at);
  const key = `daniel caesar|${venue.toLowerCase()}|2026-11-20`;
  const plans = createShowAttendanceRepository(db);
  plans.writeExactAttendance({ userId: member, key, state: "going", visibility: "private", at,
    descriptor: { tourDateId: id, legacyKey: key, claimLegacyAlias: true, artist: caesar, artistKey: caesarIdentity.norm, venue, city: "Temple City",
      date: "2026-11-20", localDate: "2026-11-20", lifecycle: "upcoming", provider: "ticketmaster",
      providerEventId: partnerId, timezone: "America/Los_Angeles" } });
  const shows = createShowRepository(db, { now: () => at });
  const beforeShow = shows.read(key, member);
  assert.ok(beforeShow);
  assert.equal(beforeShow.viewerAttendance.state, "going");
  assert.equal(beforeShow.viewerAttendance.visibility, "private");
  assert.equal(beforeShow.venue, "Autódromo Hermanos Rodríguez");
  assert.equal(beforeShow.provider.eventId, partnerId);
  assert.equal(beforeShow.artistKey, null);
  assert.ok(beforeShow.performers.some((value) => value.name === "Jamie xx" && value.key === null));
  assert.deepEqual(read(), initial, "public correction reads are non-mutating");

  const plan = reconcileReviewedFestivalEvents(db, { at });
  assert.deepEqual(plan.map(({ id }) => id).sort(), [id, "tm_1AfZk3_Gkdw1XuQ"].sort());
  assert.deepEqual(read(), initial, "default reconciliation is a dry run");
  assert.deepEqual(reconcileReviewedFestivalEvents(db, { apply: true, at }), plan);
  assert.deepEqual(reconcileReviewedFestivalEvents(db, { apply: true, at }), []);
  assert.equal(read("tm_edc_control").venue, venue);
  assert.equal(read("tm_1AfZk3_Gkdw1XuQ").venue_provider_id, "right-venue");
  assert.equal(read("tm_1AfZk3_Gkdw1XuQ").start_local_time, "14:00:00");
  assert.equal(read().venue_country_code, "MX");
  assert.equal(read().ticket_url, ticket);
  assert.ok(visibleTourDateRowsFrom(db, null, { countryCode: "MX", city: "Mexico City", at }).some((row) => row.id === id));
  assert.ok(!visibleTourDateRowsFrom(db, null, { countryCode: "US", at }).some((row) => row.id === id));
  assert.equal(service.read({ artist: caesarIdentity }).schedule.total, 0);
  assert.equal(service.read({ artist: artist("Jamie xx") }).schedule.total, 2);

  upsertProviderTourDateRows(db, [stale], { seenAt: at + 1 });
  assert.equal(read().venue_country_code, "MX");
  assert.equal(read().start_local_time, null);
  assert.equal(read().ticket_url, ticket);
  assert.deepEqual(JSON.parse(read().billed_artists), ["Jamie xx", "Gorillaz", "Chvrches"]);
  assert.equal(shows.read(beforeShow.id, member).viewerAttendance.state, "going");
  assert.equal(shows.read(key, member).id, beforeShow.id);
  assert.equal(shows.read(key, member).venue, "Autódromo Hermanos Rodríguez");
  assert.equal(db.prepare("SELECT venue FROM shows WHERE id=?").get(beforeShow.id).venue, venue,
    "stored canonical identity and plan remain in place, corrected only in view");
});

test("a reconciliation failure rolls back earlier rows and preserves admission data", () => {
  const first = { ...stale, id: "tm_a_flow_fixture", provider_event_id: "a_flow_fixture", artist: "Flow Fest",
    artist_key: null, event_name: "Coca-Cola Flow Fest", date: "2026-11-28", billed_artists: [] };
  const second = { ...first, id: "tm_b_flow_fixture", provider_event_id: "b_flow_fixture" };
  legacy(first, second);
  const before = [read(first.id), read(second.id)];
  db.exec(`CREATE TEMP TRIGGER fixture_repair_guard BEFORE UPDATE ON tour_dates
    WHEN NEW.id='tm_b_flow_fixture' BEGIN SELECT RAISE(ABORT,'fixture rejects update'); END`);
  try {
    assert.throws(() => reconcileReviewedFestivalEvents(db, { apply: true, at }), /fixture rejects update/);
    assert.deepEqual([read(first.id), read(second.id)], before);
  } finally {
    db.exec("DROP TRIGGER fixture_repair_guard");
  }
});
