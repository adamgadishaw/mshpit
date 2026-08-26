import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_ENTITY_THRESHOLDS as T, hasSubstantivePublicText, isStrictCalendarDate, isStrictIsoDateTime, publishableAttendanceCount, qualifiesCityConcertDirectory, qualifiesCityVenueDirectory, structuredCityIdentity } from "./publicEntityPolicy.js";
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
