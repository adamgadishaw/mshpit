import assert from "node:assert/strict";
import test from "node:test";
import { discoverEventWeeks, isFestivalListing, localDateKey } from "./discoverEventWeeks.mjs";

// Midday UTC keeps the calendar day the same in any time zone the tests run in.
// 2026-10-01 is a Thursday.
const NOW = Date.parse("2026-10-01T12:00:00Z");
const show = (id, date, extra = {}) => ({ id, date, artist: id, ...extra });

test("shows group into Monday-first weeks and days with plain labels", () => {
  const weeks = discoverEventWeeks([
    show("residency", "2026-09-25"),
    show("a", "2026-10-01"),
    show("b", "2026-10-02"),
    show("c", "2026-10-02"),
    show("d", "2026-10-05"),
    show("e", "2026-10-14"),
    show("f", "2026-10-29"),
    show("g", "2026-11-03"),
    show("bad", "soon"),
  ], { now: NOW });
  assert.deepEqual(weeks.map((week) => [week.key, week.label, week.count]), [
    ["2026-09-28", "This week", 4],
    ["2026-10-05", "Next week", 1],
    ["2026-10-12", "Oct 12 to 18", 1],
    ["2026-10-26", "Oct 26 to Nov 1", 1],
    ["2026-11-02", "Nov 2 to 8", 1],
  ]);
  assert.deepEqual(weeks[0].days.map((day) => [day.label, day.events.map((event) => event.id)]), [
    ["Today", ["residency", "a"]],
    ["Tomorrow", ["b", "c"]],
  ], "a run that started earlier is listed under today");
  assert.equal(weeks[1].days[0].label, "Mon, Oct 5");
  assert.deepEqual(discoverEventWeeks([], { now: NOW }), []);
  assert.deepEqual(discoverEventWeeks(null, { now: NOW }), []);
});

test("festival listings are kept for the Festivals tab", () => {
  assert.equal(isFestivalListing({ eventKind: "festival" }), true);
  assert.equal(isFestivalListing({ eventKind: "multi_day" }), true);
  assert.equal(isFestivalListing({ eventKind: "concert" }), false);
  assert.equal(isFestivalListing({}), false);
  assert.equal(localDateKey(NOW), "2026-10-01");
});
