import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PUBLIC_ENTITY_THRESHOLDS as T,
  currentOrUpcomingPublicMusicEventSql,
  hasCompleteRichMusicEventRecord,
  hasSubstantivePublicText,
  isCurrentOrUpcomingPublicMusicEvent,
  isIndexableMusicEventRecord,
  isPublicMusicEventCandidate,
  isStrictCalendarDate,
  isStrictIsoDateTime,
  publishableAttendanceCount,
  qualifiesCityConcertDirectory,
  qualifiesCityVenueDirectory,
  structuredCityIdentity,
} from "./publicEntityPolicy.js";
test("substantive text thresholds normalize whitespace and honor boundaries", () => {
  for (const n of [T.authoredBodyCharacters - 1, T.authoredBodyCharacters, T.authoredBodyCharacters + 1]) assert.equal(hasSubstantivePublicText("x".repeat(n), T.authoredBodyCharacters), n >= T.authoredBodyCharacters);
  assert.equal(hasSubstantivePublicText(" x  \n y ", 3), true);
});
test("strict calendar and offset date-times reject impossible values", () => {
  for (const value of ["2024-02-29", "2026-08-26"]) assert.equal(isStrictCalendarDate(value), true);
  for (const value of ["2023-02-29", "2026-04-31", "2026-13-01", "2026-8-01"]) assert.equal(isStrictCalendarDate(value), false);
  for (const value of ["2026-08-26T20:30Z", "2026-08-26T20:30:45.123-04:00"]) assert.equal(isStrictIsoDateTime(value), true);
  for (const value of ["2026-02-30T20:30Z", "2026-08-26T24:00Z", "2026-08-26T20:60Z", "2026-08-26T20:30", "2026-08-26T20:30+14:01"]) assert.equal(isStrictIsoDateTime(value), false);
});
test("structured city identity never accepts place or home-city fallbacks", () => {
  assert.deepEqual(structuredCityIdentity({ venueCountryCode: "ca", venueCity: " Toronto " }), { countryCode: "CA", city: "Toronto" });
  assert.equal(structuredCityIdentity({ place: "Toronto, ON", homeCity: "Toronto" }), null);
});
test("city and attendance thresholds are exact at minus one, boundary, and plus one", () => {
  assert.equal(qualifiesCityConcertDirectory({ itemCount: 3, venueCount: 1 }), false); assert.equal(qualifiesCityConcertDirectory({ itemCount: 3, venueCount: 2 }), true); assert.equal(qualifiesCityConcertDirectory({ itemCount: 4, venueCount: 3 }), true);
  assert.equal(qualifiesCityVenueDirectory({ itemCount: 2, venueCount: 2 }), false); assert.equal(qualifiesCityVenueDirectory({ itemCount: 3, venueCount: 2 }), true); assert.equal(qualifiesCityVenueDirectory({ itemCount: 4, venueCount: 3 }), true);
  assert.equal(publishableAttendanceCount(4), null); assert.equal(publishableAttendanceCount(5), 5); assert.equal(publishableAttendanceCount(6), 6);
});

test("provider music evidence fails closed while member-owned concert records remain eligible", () => {
  assert.equal(isIndexableMusicEventRecord(null), false);
  assert.equal(isCurrentOrUpcomingPublicMusicEvent(null, "2026-09-05"), false);
  assert.equal(isPublicMusicEventCandidate({ owner_id: null, music_qualified: null }), false);
  assert.equal(isPublicMusicEventCandidate({ owner_id: null, music_qualified: 0 }), false);
  assert.equal(isPublicMusicEventCandidate({ owner_id: null, music_qualified: 1 }), true);
  assert.equal(isPublicMusicEventCandidate({ owner_id: "member-1", music_qualified: null }), true);
  assert.equal(isPublicMusicEventCandidate({ owner_id: "member-1", music_qualified: 0 }), true);
  assert.equal(isPublicMusicEventCandidate({ event_name: "Repository-filtered concert" }), true);
});

test("SEO event policy rejects ticket products and non-concert event kinds", () => {
  const concert = { owner_id: null, music_qualified: 1, event_kind: "concert", event_name: "The Beaches at History" };
  assert.equal(isIndexableMusicEventRecord(concert), true);
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_name: "Reading Festival - Weekend Camping" }), false);
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_name: "Ticket + Hotel Package" }), false);
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_name: "Full Season Pass" }), false);
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_name: "Concert Package Event" }), false);
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_name: "Bundle" }), false);
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_name: "The Eras Tour Series Finale" }), true,
    "ordinary artist event names containing series are not rejected");
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_kind: "rodeo" }), false);
  const festival = {
    ...concert,
    event_kind: "multi_day",
    event_name: "City Music Festival",
    date: "2026-09-01",
    event_end_date: "2026-09-04",
    music_evidence: "ticketmaster:classification:music",
    billed_artists: JSON.stringify(["The Beaches", "Metric"]),
  };
  assert.equal(isIndexableMusicEventRecord(festival), true);
  assert.equal(isIndexableMusicEventRecord({ ...festival, event_end_date: "2026-09-22" }), true,
    "a genuine provider multi-day event may span up to 21 elapsed days");
  assert.equal(isIndexableMusicEventRecord({ ...festival, event_end_date: "2026-09-23" }), false,
    "a provider product spanning more than 21 days is not one crawlable event");
  const explicitFestival = { ...festival, event_kind: "festival" };
  assert.equal(isIndexableMusicEventRecord({ ...explicitFestival, event_end_date: "2026-09-26" }), true,
    "an explicit provider festival may span 25 elapsed days");
  assert.equal(isIndexableMusicEventRecord({ ...explicitFestival, event_end_date: "2026-10-17" }), false,
    "an explicit provider festival may not span more than 45 elapsed days");
  assert.equal(isIndexableMusicEventRecord({
    ...explicitFestival, event_kind: "fair", event_end_date: "2026-10-17",
  }), false, "an explicit provider fair may not span more than 45 elapsed days");
  assert.equal(isIndexableMusicEventRecord({
    ...explicitFestival, owner_id: "member-1", event_end_date: "2027-09-01",
  }), true, "member-authored long ranges are not subject to provider caps");
  assert.equal(isIndexableMusicEventRecord({ ...festival, billed_artists: "[]" }), false,
    "a provider multi-day product cannot become an event page without a billed performer");
  assert.equal(isIndexableMusicEventRecord({
    ...festival,
    billed_artists: JSON.stringify([{ name: "The Beaches" }]),
  }), false, "provider objects cannot masquerade as public billed-artist strings");
  assert.equal(isIndexableMusicEventRecord({ ...concert, artist: "Pã\u009cSsy" }), false,
    "malformed provider text is withheld rather than published to search");
});

test("SEO event lifecycle ignores corrupt ranges on ordinary concerts", () => {
  const base = {
    owner_id: null,
    music_qualified: 1,
    event_kind: "concert",
    event_name: "The Beaches at History",
    artist: "The Beaches",
    venue: "History",
    date: "2026-01-15",
    event_end_date: "2026-12-31",
  };
  assert.equal(isCurrentOrUpcomingPublicMusicEvent(base, "2026-09-05"), false);
  assert.equal(isCurrentOrUpcomingPublicMusicEvent({ ...base, date: "2026-09-05" }, "2026-09-05"), true);
  assert.equal(isCurrentOrUpcomingPublicMusicEvent({
    ...base,
    event_kind: "festival",
    event_name: "City Music Festival",
    date: "2026-09-01",
    event_end_date: "2026-09-10",
    music_evidence: "ticketmaster:classification:music",
    billed_artists: ["The Beaches"],
  }, "2026-09-05"), true);
  assert.equal(isCurrentOrUpcomingPublicMusicEvent({
    ...base,
    event_kind: "festival",
    event_name: "Future Festival",
    date: "2026-09-10",
    event_end_date: "2026-10-26",
    music_evidence: "ticketmaster:classification:music",
    billed_artists: ["The Beaches"],
  }, "2026-09-05"), false, "an overlong future provider festival is not current or indexable");
  assert.equal(isCurrentOrUpcomingPublicMusicEvent({
    ...base,
    owner_id: "member-1",
    date: "2026-01-01",
    event_end_date: "2026-12-31",
  }, "2026-09-05"), true, "member-authored long ranges remain current through their end date");
});

test("SEO currentness SQL applies the same provider range bounds and unlimited member ranges", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE tour_dates (id TEXT PRIMARY KEY,owner_id TEXT,event_kind TEXT,date TEXT,event_end_date TEXT,music_evidence TEXT)");
    const insert = database.prepare("INSERT INTO tour_dates VALUES (?,?,?,?,?,?)");
    insert.run("festival-25", null, "festival", "2026-09-01", "2026-09-26", "ticketmaster:classification:music");
    insert.run("festival-46", null, "festival", "2026-09-10", "2026-10-26", "ticketmaster:classification:music");
    insert.run("fair-46", null, "fair", "2026-09-10", "2026-10-26", "ticketmaster:classification:music");
    insert.run("member-long", "member-1", "concert", "2026-01-01", "2026-12-31", "");
    insert.run("provider-concert-corrupt", null, "concert", "2026-01-01", "2026-12-31", "ticketmaster:classification:music");
    const ids = database.prepare(`SELECT id FROM tour_dates td
      WHERE ${currentOrUpcomingPublicMusicEventSql("td", "?1")} ORDER BY id`)
      .all("2026-09-05").map(({ id }) => id);
    assert.deepEqual(ids, ["festival-25", "member-long"]);
  } finally {
    database.close();
  }
});

test("rich music-event evidence requires the same identity, time, and address fields as JSON-LD", () => {
  const complete = {
    id: "event-1",
    artist: "The Beaches",
    venue: "History",
    start_date_time: "2026-09-16T19:30:00-04:00",
    venue_address_line1: "1663 Queen St E",
    venue_city: "Toronto",
    venue_country_code: "CA",
  };
  assert.equal(hasCompleteRichMusicEventRecord(complete), true);
  for (const field of ["id", "artist", "venue", "start_date_time", "venue_address_line1", "venue_city", "venue_country_code"]) {
    assert.equal(hasCompleteRichMusicEventRecord({ ...complete, [field]: null }), false, field);
  }
});
