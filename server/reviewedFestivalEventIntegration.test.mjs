import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createCityGuideRepository } from "./features/cities/cityGuideRepository.js";
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
const { persistTicketmasterMarketResult } = await import("./tourdates.js");
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
const seed = (replace, ...events) => {
  for (const raw of events) {
    const row = { ...raw, billed_artists: JSON.stringify(raw.billed_artists), updated_at: 1 };
    const fields = Object.keys(row);
    db.prepare(`INSERT ${replace ? "OR REPLACE " : ""}INTO tour_dates (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...Object.values(row));
  }
};
const legacy = (...events) => seed(false, ...events);
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
  assert.equal(primary.venueGuideAvailable, false);
  const documents = createPublicDocumentService({ database: db, origin: "https://www.example.test" });
  const document = documents.eventDocument({ id, today: "2026-11-19", at });
  assert.ok(document);
  assert.equal(document.event.place, "Mexico City, Ciudad de México, Mexico");
  assert.ok(document.event.billedArtists.includes("Jamie xx"));
  assert.ok(!document.event.billedArtists.includes(caesar));
  assert.equal(document.event.venuePath, null);
  assert.equal(document.event.address.addressCountry, "MX");
  assert.ok(!document.jsonLd.some((node) => node["@type"] === "MusicEvent"), "no false venue markup without a valid street address");
  assert.doesNotMatch(documents.render(document), /Temple City|href="\/venue\/autodromo-hermanos-rodriguez"/);
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
  assert.ok(plan.every(({ fields }) => fields.every((field) => ["artist", "artist_key", "artist_identity_status", "provider_artist_id", "billed_artists"].includes(field))));
  assert.deepEqual(read(), initial, "default reconciliation is a dry run");
  assert.deepEqual(reconcileReviewedFestivalEvents(db, { apply: true, at }), plan);
  assert.deepEqual(reconcileReviewedFestivalEvents(db, { apply: true, at }), []);
  assert.equal(read("tm_edc_control").venue, venue);
  assert.equal(read("tm_1AfZk3_Gkdw1XuQ").venue_provider_id, "right-venue");
  assert.equal(read("tm_1AfZk3_Gkdw1XuQ").start_local_time, "14:00:00");
  assert.equal(read().venue_country_code, "US");
  assert.equal(read().venue_provider_id, "bad-venue");
  assert.equal(read().venue, venue);
  assert.equal(read().ticket_url, ticket);
  assert.ok(!visibleTourDateRowsFrom(db, null, { countryCode: "MX", city: "Mexico City", at }).some((row) => row.id === id));
  assert.ok(!createCityGuideRepository(db).getGuide({ countryCode: "MX", citySlug: "mexico-city", at })?.upcoming.some((row) => [id, "tm_flow_market_fixture"].includes(row.id)));
  assert.equal(service.read({ artist: caesarIdentity }).schedule.total, 0);
  assert.equal(service.read({ artist: artist("Jamie xx") }).schedule.total, 2);

  const flow = { ...stale, id: "tm_flow_market_fixture", provider_event_id: "flow_market_fixture",
    event_name: "Coca-Cola Flow Fest", artist: "Ozuna", artist_key: null, date: "2026-11-29", billed_artists: ["Ozuna", "Kali Uchis"] };
  persistTicketmasterMarketResult(db, { market: { countryCode: "US" }, result: { rows: [stale, flow] }, seenAt: at + 1 });
  assert.equal(read(flow.id).venue_city, "Temple City");
  assert.equal(read(flow.id).venue_provider_id, "bad-venue");
  assert.equal(read(flow.id).venue, venue);
  const flowPage = documents.eventDocument({ id: flow.id, at: at + 1 });
  assert.equal(flowPage.event.address.addressCountry, "MX");
  assert.equal(flowPage.event.venuePath, null);
  assert.equal(flowPage.event.ticketUrl, ticket);
  assert.doesNotMatch(documents.render(flowPage), /Temple City/);
  assert.equal(read().venue_country_code, "US");
  assert.equal(read().venue_city, "Temple City");
  assert.equal(read().venue_provider_id, "bad-venue");
  assert.equal(read().venue, venue);
  assert.equal(read().start_local_time, "12:00:00");
  assert.equal(documents.eventDocument({ id, at }).event.timezone, "America/Mexico_City");
  assert.ok(!createCityGuideRepository(db).getGuide({ countryCode: "MX", citySlug: "mexico-city", at })?.upcoming.some((row) => [id, "tm_flow_market_fixture"].includes(row.id)));
  assert.equal(read().ticket_url, ticket);
  assert.deepEqual(JSON.parse(read().billed_artists), ["Jamie xx", "Gorillaz", "Chvrches"]);
  assert.equal(shows.read(beforeShow.id, member).viewerAttendance.state, "going");
  assert.equal(shows.read(key, member).id, beforeShow.id);
  assert.equal(shows.read(key, member).venue, "Autódromo Hermanos Rodríguez");
  assert.equal(db.prepare("SELECT venue FROM shows WHERE id=?").get(beforeShow.id).venue, venue,
    "stored canonical identity and plan remain in place, corrected only in view");
});

test("a reconciliation failure rolls back earlier rows and preserves admission data", () => {
  const first = { ...stale, id: "tm_a_friday_fixture", provider_event_id: "a_friday_fixture", artist: "Corona Capital",
    artist_key: null, event_name: "Corona Capital", billed_artists: [caesar] };
  const second = { ...first, id: "tm_b_friday_fixture", provider_event_id: "b_friday_fixture" };
  legacy(first, second);
  const before = [read(first.id), read(second.id)];
  db.exec(`CREATE TEMP TRIGGER fixture_repair_guard BEFORE UPDATE ON tour_dates
    WHEN NEW.id='tm_b_friday_fixture' BEGIN SELECT RAISE(ABORT,'fixture rejects update'); END`);
  try {
    assert.throws(() => reconcileReviewedFestivalEvents(db, { apply: true, at }), /fixture rejects update/);
    assert.deepEqual([read(first.id), read(second.id)], before);
  } finally {
    db.exec("DROP TRIGGER fixture_repair_guard");
  }
});


test("actual Corona admission IDs render Jamie xx inside the capped bill and preserve individual offers", () => {
  const friday = [
    ["tm_1AfZk3_GkdB4TdH", "Individual General Corona Capital 2026", "14006499FA57F0FC"],
    ["tm_1AfZk3_Gkdw1XuQ", "Individual Banamex Plus Corona Capital 2026", "14006499F22BE35A"],
  ];
  const sunday = ["tm_1AfZk3_GkdD5R18", "Individual General Corona Capital 2026"];
  const mexico = { ...stale, artist: "Gorillaz", artist_key: null, venue: "Autodromo Hnos. Rodriguez",
    place: "Mexico City, Ciudad de Mexico, Mexico", venue_city: "Mexico City", venue_country_code: "MX",
    venue_country: "Mexico", venue_region: "Ciudad de Mexico", venue_provider_id: null,
    venue_address_line1: "Avenida Viaducto Rio de la Piedad", event_timezone: "America/Mexico_City" };
  const longBill = ["Gorillaz", caesar, ...Array.from({ length: 23 }, (_, i) => `Fixture performer ${i}`)];
  // This disposable test DB may already contain the shorter Banamex fixture.
  seed(true, ...friday.map(([id, event_name, seller], index) => ({ ...mexico, id, provider_event_id: id.slice(3),
    event_name, ticket_url: `https://www.ticketmaster.com.mx/event/${seller}`,
    billed_artists: index ? [...longBill, "Jamie xx"] : longBill })),
    { ...mexico, id: sunday[0], provider_event_id: sunday[0].slice(3), event_name: sunday[1],
      date: "2026-11-22", artist: "The xx", billed_artists: ["The xx", "Angine de Poitrine", "Good Kid", "Purity Ring"] });
  const documents = createPublicDocumentService({ database: db, origin: "https://www.example.test" });
  for (const [id, , seller] of friday) {
    const page = documents.eventDocument({ id, at, today: "2026-11-19" });
    const offer = `https://www.ticketmaster.com.mx/event/${seller}`;
    assert.equal(page.event.billedArtists.length, 20);
    assert.equal(page.event.billedArtists.filter((name) => name === "Jamie xx").length, 1, id);
    assert.ok(!page.event.billedArtists.includes(caesar));
    const html = documents.render(page);
    const visibleLineup = html.match(/<strong>Lineup:<\/strong>([^<]+)/)?.[1];
    assert.match(visibleLineup, /Jamie xx/);
    assert.doesNotMatch(visibleLineup, /Daniel Caesar/);
    assert.ok(html.includes(`href="${offer}"`));
    const schema = page.jsonLd.find((node) => node["@type"] === "MusicEvent");
    assert.ok(schema.performer.some(({ name, url }) => name === "Jamie xx" && !url));
    assert.ok(!schema.performer.some(({ name }) => name === caesar));
    assert.equal(schema.offers.url, offer);
    assert.equal(read(id).ticket_url, offer);
  }
  const sundayPage = documents.eventDocument({ id: sunday[0], at, today: "2026-11-19" });
  assert.deepEqual(sundayPage.event.billedArtists, ["The xx", "Angine de Poitrine", "Good Kid", "Purity Ring"]);
  assert.ok(sundayPage.jsonLd.find((node) => node["@type"] === "MusicEvent").performer.some(({ name }) => name === "The xx"));
  const sundayLineup = documents.render(sundayPage).match(/<strong>Lineup:<\/strong>([^<]+)/)?.[1];
  assert.match(sundayLineup, /The xx/);
  assert.doesNotMatch(sundayLineup, /Jamie xx/);
});
