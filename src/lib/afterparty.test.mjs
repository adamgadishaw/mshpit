import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { AFTERPARTY_CATEGORIES, AFTER_SHOW_TRAVEL_MODES, afterpartySearches, afterShowContext, afterShowDirections, mapsDir, mapsSearch, verifiedVenueCoordinate } from "./afterparty.js";

const coord = { lat: 43.654, lng: -79.379 };
const show = { id: "fixture-show", venue: "Massey Hall", city: "Toronto", date: "2026-11-11" };

test("category discovery uses documented, venue-named searches with no availability or ranking claims", () => {
  const searches = afterpartySearches(coord, "Massey Hall, Toronto");
  assert.equal(searches.length, AFTERPARTY_CATEGORIES.length);
  for (const search of searches) {
    const url = new URL(search.url);
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/maps/search/");
    assert.equal(url.searchParams.get("api"), "1");
    assert.ok(url.searchParams.get("query").endsWith(" near Massey Hall, Toronto"));
    assert.doesNotMatch(search.url, /open.now|departure|arrival|15z/i);
    for (const key of ["name", "openUntil", "walk", "rating", "checkedAt"]) assert.equal(Object.hasOwn(search, key), false);
  }
});

test("intent changes filter actual actions, in stable order", () => {
  assert.deepEqual(afterpartySearches(coord, "", "food").map(x => x.id), ["late-food", "coffee"]);
  assert.deepEqual(afterpartySearches(coord, "", "stay-out").map(x => x.id), ["bars", "clubs", "activities"]);
  assert.deepEqual(afterpartySearches(coord, "", "get-home"), []);
  assert.deepEqual(afterpartySearches(coord, "", "unknown"), []);
});

test("missing and ambiguous coordinates do not become nearby searches or routes", () => {
  for (const invalid of [null, {}, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: "", lng: 0 }, { lat: " ", lng: 0 }, { lat: [], lng: 0 }, { lat: false, lng: 0 }, { lat: NaN, lng: 0 }]) {
    assert.equal(verifiedVenueCoordinate(invalid), null);
    assert.deepEqual(afterpartySearches(invalid), []);
    assert.equal(afterShowDirections(invalid, "Station"), null);
  }
  assert.deepEqual(verifiedVenueCoordinate({ lat: "0", lng: 0 }), { lat: 0, lng: 0 });
  assert.equal(mapsSearch("", coord), null);
  assert.equal(new URL(mapsSearch("bars", coord)).searchParams.get("query"), "bars near 43.654,-79.379");
});

test("routes always start at the venue; encode destination and allow only supported modes", () => {
  for (const { id } of AFTER_SHOW_TRAVEL_MODES) {
    const url = new URL(afterShowDirections(coord, "  Hotel & station #2\nToronto  ", id));
    assert.equal(url.pathname, "/maps/dir/");
    assert.equal(url.searchParams.get("api"), "1");
    assert.equal(url.searchParams.get("origin"), "43.654,-79.379");
    assert.equal(url.searchParams.get("destination"), "Hotel & station #2 Toronto");
    assert.equal(url.searchParams.get("travelmode"), id);
    assert.equal(url.searchParams.has("dir_action"), false, "No immediate navigation from the phone.");
    assert.equal(url.searchParams.has("departure_time"), false, "Unsupported future-time parameter must not imply scheduling.");
  }
  for (const destination of ["", " ", null, {}, false]) assert.equal(afterShowDirections(coord, destination), null);
  assert.equal(afterShowDirections(coord, "Station", "flying"), null);
  assert.equal(new URL(afterShowDirections(coord, "x".repeat(500))).searchParams.get("destination").length, 200);
  assert.equal(new URL(mapsDir(coord.lat, coord.lng)).searchParams.get("destination"), "43.654,-79.379", "Existing TO-venue contract stays compatible.");
});

test("special venue text cannot inject link parameters", () => {
  const url = new URL(mapsSearch("food", coord, "A&B #Hall / Toronto?origin=elsewhere"));
  assert.deepEqual([...url.searchParams.keys()], ["api", "query"]);
  assert.ok(url.searchParams.get("query").endsWith("A&B #Hall / Toronto?origin=elsewhere"));
});

test("calendar context has no inferred end time or open-now claim", () => {
  const model = afterShowContext({ ...show, startTime: "20:00", timezone: "America/Toronto" }, coord);
  assert.equal(model.showDate, "Wed, Nov 11, 2026");
  assert.match(model.timingNote, /after midnight/);
  assert.match(model.timingNote, /finish time isn’t confirmed/);
  for (const bad of ["2026-02-30", "2026-11-11T20:00:00Z", "", "unknown"]) assert.equal(afterShowContext({ ...show, date: bad }, coord).showDate, null);
  assert.equal(afterShowContext(null, null).showDate, null);
  assert.equal(afterShowContext({ date: "2026-11-12T01:00:00Z", localDate: "2026-11-11" }, coord).showDate, "Wed, Nov 11, 2026");
  assert.equal(afterShowContext({ date: "2026-11-11", localDate: "invalid" }, coord).showDate, "Wed, Nov 11, 2026");
  assert.match(afterShowContext({ ...show, eventEndDate: "2026-11-13" }, coord).showDate, /Fri, Nov 13, 2026/);
});

test("date-only display survives midnight, DST, leap day and remote device timezones", () => {
  const cases = ["2026-03-08", "2026-11-01", "2028-02-29", "2026-12-31"];
  for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati", "Etc/UTC"]) {
    const code = `import { afterShowContext } from ${JSON.stringify(new URL("./afterparty.js", import.meta.url).href)}; console.log(JSON.stringify(${JSON.stringify(cases)}.map(date => afterShowContext({ date }).showDate)));`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), cases.map(date => afterShowContext({ date }).showDate));
  }
});

test("target changes reset local planning state; cancellation and history stay neutral", () => {
  const first = afterShowContext(show, coord, "upcoming");
  for (const lifecycle of ["completed", "cancelled", "postponed"]) {
    const context = afterShowContext(show, coord, lifecycle);
    assert.equal(context.title, "AROUND THE VENUE");
    assert.match(context.timingNote, /current listings, not availability/);
    assert.notEqual(context.scope, first.scope);
  }
  assert.notEqual(afterShowContext({ ...show, id: "another" }, coord).scope, first.scope);
  assert.notEqual(afterShowContext(show, { ...coord, lng: -80 }).scope, first.scope);
  assert.equal(afterShowContext({ ...show, overall: 5 }, coord, "upcoming").scope, first.scope, "Unrelated score hydration must not reset the form.");
});
