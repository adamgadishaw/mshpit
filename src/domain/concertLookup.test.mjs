import assert from "node:assert/strict";
import test from "node:test";
import { concertLookupDate, concertMatchCanFill, concertCityMatches, mergeConcertMatches } from "./concertLookup.mjs";
test("calendar dates survive DST and opposite viewer timezones without conversion", () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ["Pacific/Kiritimati", "America/Los_Angeles", "America/Toronto"]) {
      process.env.TZ = tz;
      for (const date of ["2018-04-20", "2024-02-29", "2026-03-08", "2026-11-01"]) assert.equal(concertLookupDate(date), date);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  for (const date of ["2026-02-29", "2026-13-01", "2026-01-32", "11/01/2026", null]) assert.equal(concertLookupDate(date), null);
});
test("provider names exceeding existing location limits are never silently shortened", () => {
  assert.equal(concertMatchCanFill({ venue: "Hall", city: "Toronto" }), true);
  assert.equal(concertMatchCanFill({ venue: "x".repeat(81), city: "Toronto" }), false);
  assert.equal(concertMatchCanFill({ venue: "Hall", city: "x".repeat(241) }), false);
});
test("city matching respects supplied region and country and does not treat input as wildcards", () => {
  assert.equal(concertCityMatches("Toronto, Ontario, Canada", "Toronto"), true);
  assert.equal(concertCityMatches("Toronto, Ontario, Canada", "Toronto, Canada"), true);
  assert.equal(concertCityMatches("Toronto, Ohio, United States", "Toronto, Ontario, Canada"), false);
  assert.equal(concertCityMatches("New York, United States", "%"), false);
});
test("same provider identity and community duplicate collapse; distinct event IDs and cities survive", () => {
  const row = { artist: "Act", venue: "Hall", date: "2018-04-20", city: "Toronto", id: "archive", source: "community" };
  const event = { ...row, id: "tm_1", eventId: "tm_1", source: "catalog" };
  assert.equal(mergeConcertMatches([row, event], [{ ...event, source: "ticketmaster" }]).length, 1);
  assert.equal(mergeConcertMatches([event], [{ ...event, id: "tm_2", eventId: "tm_2" }]).length, 2);
  assert.equal(mergeConcertMatches([row], [{ ...row, id: "other", city: "London" }]).length, 2);
  assert.equal(mergeConcertMatches([row], [{ ...event, city: "Toronto, Ontario, Canada" }]).length, 1);
  assert.equal(mergeConcertMatches([{ ...row, city: "Toronto, Ohio, United States" }], [{ ...event, city: "Toronto, Ontario, Canada" }]).length, 2);
});
