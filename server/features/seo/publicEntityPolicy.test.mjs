import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_ENTITY_THRESHOLDS as T,
  hasCompleteRichMusicEventRecord,
  hasSubstantivePublicText,
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
  assert.equal(isIndexableMusicEventRecord({ ...concert, event_kind: "rodeo" }), false);
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
