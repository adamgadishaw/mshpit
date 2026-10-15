import test from "node:test";
import assert from "node:assert/strict";
import { FESTIVAL_ACCENTS, festivalAccent, festivalCountdown, festivalMonths, festivalSummary } from "./festivalFormat.mjs";

// Midday UTC keeps the calendar day the same in every time zone a test runs in.
const NOON = (day) => Date.parse(`${day}T12:00:00Z`);
const lolla = { startDate: "2027-07-29", endDate: "2027-08-01" };

test("the countdown counts calendar days and stops once the festival is over", () => {
  assert.deepEqual(festivalCountdown(lolla, NOON("2027-07-30")), { days: 0, live: true, label: "Happening now" });
  assert.deepEqual(festivalCountdown(lolla, NOON("2027-07-29")), { days: 0, live: true, label: "Happening now" });
  assert.equal(festivalCountdown(lolla, NOON("2027-08-01")).label, "Happening now", "the last day still counts");
  assert.equal(festivalCountdown(lolla, NOON("2027-08-02")), null);
  assert.equal(festivalCountdown(lolla, NOON("2027-07-28")).label, "Starts tomorrow");
  assert.equal(festivalCountdown(lolla, NOON("2027-07-24")).label, "In 5 days");
  assert.equal(festivalCountdown(lolla, NOON("2027-07-08")).label, "In 3 weeks");
  assert.equal(festivalCountdown(lolla, NOON("2027-03-29")).label, "In 4 months");
  assert.equal(festivalCountdown({ startDate: "2027-07-29" }, NOON("2027-07-30")), null, "a one-day festival ends the same day");
  assert.equal(festivalCountdown({ startDate: "soon" }), null);
  assert.equal(festivalCountdown(null), null);
});

test("each festival keeps the same colours, and they vary between festivals", () => {
  assert.deepEqual(festivalAccent("lollapalooza"), festivalAccent("lollapalooza"));
  assert.ok(FESTIVAL_ACCENTS.includes(festivalAccent("rolling-loud")));
  assert.ok(FESTIVAL_ACCENTS.includes(festivalAccent("")));
  const slugs = ["lollapalooza", "rolling-loud", "coachella", "glastonbury", "bonnaroo", "osheaga", "primavera-sound", "governors-ball"];
  assert.ok(new Set(slugs.map((slug) => festivalAccent(slug).join())).size >= 3);
});

test("editions group by starting month, and the summary counts what is coming", () => {
  const upcoming = [
    { id: "a", startDate: "2027-06-04", countryCode: "US", lineupChangedAt: NOON("2027-05-20") },
    { id: "b", startDate: "2027-06-26", countryCode: "GB" },
    { id: "c", startDate: "2027-07-29", endDate: "2027-08-01", countryCode: "US" },
    { id: "bad", startDate: null },
  ];
  assert.deepEqual(festivalMonths(upcoming).map((month) => [month.key, month.title, month.short, month.editions.map((edition) => edition.id)]),
    [["2027-06", "June 2027", "Jun 2027", ["a", "b"]], ["2027-07", "July 2027", "Jul 2027", ["c"]]]);
  const summary = festivalSummary(upcoming, NOON("2027-05-25"));
  assert.deepEqual([summary.festivals, summary.newLineups, summary.countries, summary.next.id], [4, 1, 2, "a"]);
  assert.equal(festivalSummary(upcoming, NOON("2027-06-10")).next.id, "b", "a festival already over is not next");
  assert.equal(festivalSummary([]).next, null);
});
