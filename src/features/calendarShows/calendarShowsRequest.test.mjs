import test from "node:test";
import assert from "node:assert/strict";
import { calendarLocalEvent, calendarMonthBounds, calendarShowsFromResponse, calendarShowsQuery, calendarShowsRequest } from "./calendarShowsRequest.mjs";

const options = { cursor: { y: 2026, m: 10 }, selected: "2026-11-20", accountId: "member-a", authEpoch: 1 };
const query = calendarShowsQuery(options);
const event = (id = "late-month") => ({ id, artist: "Band", venue: "Hall", date: "2026-11-20" });
function response(changes = {}) {
  return { tourDates: [event()], nextCursor: null, complete: true,
    range: { month: query.month, from: query.from, through: query.through, date: query.date, fromDate: query.fromDate, city: null, country: null },
    monthSummary: { dayPresence: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, "0")}`, i === 19])), complete: true }, ...changes };
}

test("selected date requests a real month window beyond the rolling 90-day range", () => {
  const future = calendarShowsQuery({ ...options, cursor: { y: 2027, m: 6 }, selected: "2027-07-24" });
  const request = calendarShowsRequest(future);
  assert.equal(request.path, "/api/tourdates?month=2027-07&limit=100&date=2027-07-24");
  assert.equal(request.expectedAccountId, "member-a");
  assert.deepEqual(calendarMonthBounds({ y: 2028, m: 1 }), { month: "2028-02", from: "2028-02-01", through: "2028-02-29", days: 29 });
  assert.throws(() => calendarShowsQuery({ ...options, selected: "2026-12-01" }), /date in this calendar month/);
});

test("agenda and Local use server filters before paging; plans and missing location never become worldwide", () => {
  const local = calendarShowsQuery({ ...options, presentation: "agenda", scope: "local", homeCity: "Toronto", homeCountry: "Canada" });
  assert.equal(calendarShowsRequest(local, { after: "next-page" }).path,
    "/api/tourdates?month=2026-11&limit=100&fromDate=2026-11-20&city=Toronto&country=CA&after=next-page");
  assert.equal(calendarShowsQuery({ ...options, scope: "plans" }).enabled, false);
  assert.equal(calendarShowsQuery({ ...options, scope: "local", homeCountry: "Canada" }).needsLocation, true);
  assert.equal(calendarShowsQuery({ ...options, scope: "local", homeCountry: "Canada" }).enabled, false);
  const unmapped = calendarShowsQuery({ ...options, scope: "local", homeCity: "Pristina", homeCountry: "Kosovo" });
  assert.equal(unmapped.country, "Kosovo");
  assert.match(calendarShowsRequest(unmapped).path, /city=Pristina&country=Kosovo/);
});

test("day presence covers later dates independently of a paged selected-day result", () => {
  const payload = response({ nextCursor: "more-on-day", complete: false });
  const parsed = calendarShowsFromResponse(payload, query);
  assert.equal(parsed.complete, false);
  assert.equal(parsed.monthSummary.complete, true);
  assert.equal(parsed.monthSummary.dayPresence["2026-11-20"], true);
  assert.equal(parsed.monthSummary.dayPresence["2026-11-30"], false);
});

test("an old backend or mismatched month/filter cannot masquerade as complete coverage", () => {
  for (const payload of [
    { tourDates: [event()] },
    { tourDates: [event()], nextCursor: null, range: { days: 30, through: "2026-12-10" } },
    response({ range: { ...response().range, month: "2026-12" } }),
    response({ range: { ...response().range, date: null } }),
    response({ range: { ...response().range, city: "London" } }),
    response({ complete: true, nextCursor: "more" }),
    response({ nextCursor: undefined }),
    response({ monthSummary: { dayPresence: { "2026-11-20": true }, complete: true } }),
  ]) assert.throws(() => calendarShowsFromResponse(payload, query), { code: "CALENDAR_RANGE_UNAVAILABLE" });
});

test("unknown presence stays unknown; returned events must overlap the selected window", () => {
  const incomplete = calendarShowsFromResponse(response({ monthSummary: { dayPresence: { "2026-11-20": true }, complete: false } }), query);
  assert.equal(incomplete.monthSummary.dayPresence["2026-11-30"], undefined);
  assert.equal(incomplete.monthSummary.complete, false);
  const festival = { ...event(), date: "2026-11-18", eventEndDate: "2026-11-22" };
  assert.equal(calendarShowsFromResponse(response({ tourDates: [festival] }), query).events.length, 1);
  assert.throws(() => calendarShowsFromResponse(response({ tourDates: [{ ...event(), date: "2026-11-19" }] }), query));
  assert.throws(() => calendarShowsFromResponse(response({ tourDates: [{ ...festival, eventEndDate: "2026-11-19" }] }), query));
});

test("personal Local projection uses city and country and never relabels unknown country", () => {
  const home = { homeCity: "London", homeCountry: "GB" };
  assert.equal(calendarLocalEvent({ city: "London", venueCountryCode: "GB" }, home), true);
  assert.equal(calendarLocalEvent({ city: "London", venueCountryCode: "CA" }, home), false);
  assert.equal(calendarLocalEvent({ city: "Toronto", venueCountryCode: "CA" }, home), false);
  assert.equal(calendarLocalEvent({ city: "London" }, home), false);
  assert.equal(calendarLocalEvent({ place: "London, England, United Kingdom" }, home), true);
  assert.equal(calendarLocalEvent({ city: "Toronto" }, { homeCity: "Toronto", homeCountry: "Canada", countryForCity: () => "Canada" }), true);
  assert.equal(calendarLocalEvent({ city: "London", country: "Canada" }, { ...home, countryForCity: () => "United Kingdom" }), false);
});
