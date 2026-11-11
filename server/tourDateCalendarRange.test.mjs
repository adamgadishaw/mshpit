import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeTourDateCalendarCursor, tourDateCalendarRequest, tourDateCalendarSummary,
} from "./tourDateCalendarRange.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-calendar-month-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword } = await import("./auth.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const at = Date.now();
const current = new Date(at);
const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 4, 1));
const month = first.toISOString().slice(0, 7);
const day = (number) => `${month}-${String(number).padStart(2, "0")}`;
const previousDay = new Date(first.getTime() - 86400000).toISOString().slice(0, 10);
const nextMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
const route = routes["GET /api/tourdates"];
let sequence = 0;

function event({ id = `calendar_${++sequence}`, date = day(1), city = "Calendar City", countryCode = "ZZ", country = "Testland", ownerId = null, releaseAt = 0, status = "scheduled", active = 1, kind = "concert", end = null, evidence = null, artist = null, venue = "Calendar Hall" } = {}) {
  db.prepare(`INSERT INTO tour_dates (
    id,artist,venue,place,date,source,updated_at,release_at,owner_id,
    venue_city,venue_country_code,venue_country,music_qualified,provider_active,
    event_kind,event_end_date,music_evidence,billed_artists,event_timezone,event_status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, artist ?? `Artist ${id}`, venue, `${city}, ${country}`, date, "ticketmaster", at, releaseAt, ownerId,
    city, countryCode, country, 1, active, kind, end, evidence, evidence ? '["Billed Musician"]' : '[]', "UTC", status,
  );
  return id;
}

function page(query = {}, user = null) {
  return route({ query: { month, city: "Calendar City", country: "ZZ", ...query }, ...(user ? { user } : {}) });
}

function member() {
  const id = `calendar_member_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "fixture-hash", "fan", "Toronto", 43.65, -79.38, "AD", "#123456", at);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(at, id);
  return q.userById.get(id);
}

function authoredFixture() {
  const account = member();
  const city = `Calendar Access ${sequence}`;
  const artist = routes["POST /api/artist-pages"]({ user: account, ip: account.id,
    body: { artistName: `Calendar Access Artist ${sequence}` } }).artist;
  const owner = q.userById.get(account.id);
  const show = routes["POST /api/tourdates"]({ user: owner, ip: owner.id,
    body: { dates: [{ venue: "Calendar Access Hall", place: `${city}, Testland`, date: day(15) }] } }).tourDates[0];
  db.prepare("UPDATE tour_dates SET venue_city=?,venue_country_code='ZZ',venue_country='Testland' WHERE id=?").run(city, show.id);
  return { owner, artist, id: show.id, city };
}

function assertDayVisibility({ city, id }, viewer, expected, label = "viewer") {
  const result = page({ city, date: day(15) }, viewer);
  assert.equal(result.tourDates.some((row) => row.id === id), expected, `${label}: selected rows`);
  assert.equal(result.monthSummary.dayPresence[day(15)], expected, `${label}: month presence`);
  assert.equal(result.monthSummary.complete, true);
}

test("month pagination and presence cover later days beyond a full first page", () => {
  const city = "Calendar Paging";
  db.exec("BEGIN");
  for (let index = 0; index < 601; index += 1) event({ id: `calendar_page_${String(index).padStart(4, "0")}`, city });
  const later = [event({ city, date: day(15) }), event({ city, date: day(15) })];
  event({ city, date: `${nextMonth}-01` });
  db.exec("COMMIT");
  const firstPage = page({ city, limit: "500" });
  assert.equal(firstPage.tourDates.length, 500);
  assert.equal(firstPage.complete, false);
  assert.ok(firstPage.nextCursor);
  assert.deepEqual(firstPage.range, {
    month, from: day(1), through: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
    city, country: "ZZ", date: null, fromDate: null,
  });
  assert.equal(firstPage.monthSummary.complete, true);
  assert.equal(firstPage.monthSummary.dayPresence[day(1)], true);
  assert.equal(firstPage.monthSummary.dayPresence[day(2)], false);
  assert.equal(firstPage.monthSummary.dayPresence[day(15)], true, "later dates remain visible independently of loaded event rows");
  assert.equal(Object.keys(firstPage.monthSummary.dayPresence).length, Number(firstPage.range.through.slice(-2)));
  const secondPage = page({ city, limit: "500", after: firstPage.nextCursor });
  assert.equal(secondPage.tourDates.length, 103);
  assert.equal(secondPage.complete, true);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.tourDates, ...secondPage.tourDates].map(({ id }) => id)).size, 603);
  const selected = page({ city, date: day(15) });
  assert.deepEqual(selected.tourDates.map(({ id }) => id), later);
  assert.equal(selected.monthSummary.dayPresence[day(1)], true, "selected-day requests retain whole-month presence");
  assert.deepEqual(page({ city, fromDate: day(14) }).tourDates.map(({ id }) => id), later);
});

test("month and day bounds include overlapping festivals and normalize legacy dates", () => {
  const city = "Calendar Overlap";
  const festival = event({ city, date: previousDay, end: day(3), kind: "festival", evidence: "ticketmaster:classification:music" });
  const legacy = event({ city, date: day(15).replaceAll("-", " · ") });
  event({ city, date: `${nextMonth}-01`.replaceAll("-", " · ") });
  event({ city, date: day(15), status: " CANCELED " });
  event({ city, date: day(15), active: 0 });
  event({ city, date: day(15), countryCode: "US", country: "United States" });
  event({ city: "Unrelated City", date: day(15) });
  const result = page({ city });
  assert.deepEqual(new Set(result.tourDates.map(({ id }) => id)), new Set([festival, legacy]));
  assert.equal(result.monthSummary.dayPresence[day(1)], true);
  assert.equal(result.monthSummary.dayPresence[day(3)], true);
  assert.equal(result.monthSummary.dayPresence[day(4)], false);
  assert.deepEqual(page({ city, date: day(2) }).tourDates.map(({ id }) => id), [festival]);
  assert.deepEqual(page({ city, date: day(15), country: "Testland" }).tourDates.map(({ id }) => id), [legacy]);
});

test("explicit calendar months include historical shows while discovery remains upcoming-only", () => {
  const historicalFirst = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 2, 1));
  const historicalMonth = historicalFirst.toISOString().slice(0, 7);
  const historicalDate = `${historicalMonth}-15`;
  const city = "Calendar History";
  const retained = event({ city, date: historicalDate, active: 0 });
  event({ city, date: historicalDate, status: "cancelled" });
  const result = page({ month: historicalMonth, city, date: historicalDate });
  assert.deepEqual(result.tourDates.map(({ id }) => id), [retained], "historical provider evidence survives healthy upstream withdrawal");
  assert.equal(result.complete, true);
  assert.equal(result.monthSummary.dayPresence[historicalDate], true);
  assert.equal(result.monthSummary.dayPresence[`${historicalMonth}-16`], false);
  assert.deepEqual(route({ query: { days: "90", city, country: "ZZ" } }).tourDates, []);
  const archiveIds = [event({ city, date: "1965-07-15", active: 0 }), event({ city, date: "1965-07-16", active: 0 })];
  const archive = page({ city, month: "1965-07", limit: "1" });
  assert.deepEqual(archive.tourDates.map(({ id }) => id), archiveIds.slice(0, 1));
  assert.equal(archive.monthSummary.dayPresence["1965-07-16"], true);
  assert.deepEqual(page({ city, month: "1965-07", limit: "1", after: archive.nextCursor }).tourDates.map(({ id }) => id), archiveIds.slice(1));
});

test("month queries preserve authored privacy, release timing and blocks without hiding independent providers", () => {
  const owner = member();
  const viewer = member();
  const city = "Calendar Privacy";
  routes["POST /api/artist-pages"]({ user: owner, ip: owner.id, body: { artistName: `Calendar Privacy Artist ${sequence}` } });
  const artistOwner = q.userById.get(owner.id);
  const authored = routes["POST /api/tourdates"]({ user: artistOwner, ip: owner.id,
    body: { dates: [{ venue: "Calendar Private Hall", place: `${city}, Testland`, date: day(15) }] } }).tourDates[0];
  db.prepare("UPDATE tour_dates SET venue_city=?,venue_country_code='ZZ',venue_country='Testland' WHERE id=?").run(city, authored.id);
  const provider = event({ city, date: day(2) });
  const ids = (user) => page({ city }, user).tourDates.map(({ id }) => id);
  assert.ok(ids(viewer).includes(authored.id));
  db.prepare("UPDATE tour_dates SET release_at=? WHERE id=?").run(at + 86400000, authored.id);
  assert.equal(ids(viewer).includes(authored.id), false);
  assert.equal(ids(artistOwner).includes(authored.id), true);
  db.prepare("UPDATE tour_dates SET release_at=0 WHERE id=?").run(authored.id);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  assert.deepEqual(ids(viewer), [provider]);
  assert.equal(page({ city }, viewer).monthSummary.dayPresence[day(15)], false);
  assert.ok(ids(artistOwner).includes(authored.id));
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
  assert.ok(ids(viewer).includes(authored.id));
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(owner.id, viewer.id, at);
  assert.deepEqual(ids(viewer), [provider]);
});

const authoredAccessCases = [
  { name: "unreleased nonowner", publication: "unreleased", readers: [false, false, true] },
  { name: "private owner", audience: "only_me", readers: [false, false, true] },
  { name: "members-only owner", audience: "members", readers: [false, true, true] },
  { name: "banned owner", accountField: "is_banned", accountValue: 1 },
  { name: "dormant owner", accountField: "dormant_at", accountValue: at },
  { name: "suspended owner", accountField: "suspended_until", accountValue: at + 86400000 },
  { name: "removed artist page", profileField: "removed", profileValue: 1 },
  { name: "pending identity hold", profileField: "identity_review_status", profileValue: "pending" },
  { name: "rejected identity hold", profileField: "identity_review_status", profileValue: "rejected" },
  { name: "withdrawn page ownership", profileField: "owner_id", profileValue: null },
  { name: "hidden retained publication", publication: "withheld" },
  { name: "creator blocks viewer", block: "creator", readers: [true, false, true] },
  { name: "viewer blocks creator", block: "viewer", readers: [true, false, true] },
];

for (const scenario of authoredAccessCases) {
  test(`month rows and presence enforce authored visibility: ${scenario.name}`, () => {
    const fixture = authoredFixture();
    const viewer = member();
    for (const actor of [null, viewer, fixture.owner]) assertDayVisibility(fixture, actor, true, "before restriction");
    if (scenario.audience) db.prepare("UPDATE users SET profile_audience=? WHERE id=?").run(scenario.audience, fixture.owner.id);
    // Column names come only from the fixed local scenario table above.
    if (scenario.accountField) db.prepare(`UPDATE users SET ${scenario.accountField}=? WHERE id=?`).run(scenario.accountValue, fixture.owner.id);
    if (scenario.profileField) db.prepare(`UPDATE artist_profiles SET ${scenario.profileField}=? WHERE artist_key=?`).run(scenario.profileValue, fixture.artist.key);
    if (scenario.publication === "unreleased") db.prepare("UPDATE tour_dates SET release_at=? WHERE id=?").run(at + 86400000, fixture.id);
    if (scenario.publication === "withheld") {
      const revocation = `calendar_retained_${sequence}`;
      db.prepare("INSERT INTO artist_access_revocations(id,artist_key,owner_id,reason,created_at,profile_json) VALUES(?,?,?,?,?,?)")
        .run(revocation, fixture.artist.key, fixture.owner.id, "Calendar privacy fixture", at, "{}");
      db.prepare("INSERT INTO artist_access_retained_content(revocation_id,target_type,target_id,record_json,publication,original_public,superseded) VALUES(?,'tour_date',?,'{}','hidden',1,0)")
        .run(revocation, fixture.id);
    }
    if (scenario.block) db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)")
      .run(...(scenario.block === "creator" ? [fixture.owner.id, viewer.id] : [viewer.id, fixture.owner.id]), at);
    const expected = scenario.readers || [false, false, false];
    for (const [index, actor] of [null, viewer, fixture.owner].entries()) {
      assertDayVisibility(fixture, actor && q.userById.get(actor.id), expected[index], ["anonymous", "member", "owner"][index]);
    }
  });
}

test("month rows and presence do not resurrect authored shows after account deletion", async () => {
  const fixture = authoredFixture();
  const viewer = member();
  assertDayVisibility(fixture, viewer, true);
  const password = "CalendarDeletionFixture9";
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(password), fixture.owner.id);
  await routes["DELETE /api/me"]({ user: q.userById.get(fixture.owner.id), ip: fixture.owner.id, body: { password } });
  assert.equal(q.userById.get(fixture.owner.id), undefined);
  assert.equal(db.prepare("SELECT id FROM tour_dates WHERE id=?").get(fixture.id), undefined);
  assertDayVisibility(fixture, null, false, "anonymous after erasure");
  assertDayVisibility(fixture, viewer, false, "member after erasure");
});

test("month rows and presence retain only active administrators' existing management preview", () => {
  const fixture = authoredFixture();
  const admin = member();
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(fixture.owner.id);
  db.prepare("UPDATE tour_dates SET release_at=? WHERE id=?").run(at + 86400000, fixture.id);
  assertDayVisibility(fixture, null, false, "guest cannot preview");
  assertDayVisibility(fixture, q.userById.get(admin.id), true, "active administrator management preview");
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(admin.id);
  assertDayVisibility(fixture, q.userById.get(admin.id), false, "inactive administrator has no bypass");
});

for (const scenario of [
  { name: "unqualified", column: "music_qualified", value: 0 },
  { name: "cancelled", column: "event_status", value: "cancelled" },
  { name: "canceled spelling", column: "event_status", value: " CANCELED " },
  { name: "inactive future provider", column: "provider_active", value: 0 },
]) {
  test(`month rows and presence exclude provider listings: ${scenario.name}`, () => {
    const city = `Calendar Provider ${++sequence}`;
    const fixture = { city, id: event({ city, date: day(15) }) };
    const viewer = member();
    assertDayVisibility(fixture, viewer, true, "before exclusion");
    db.prepare(`UPDATE tour_dates SET ${scenario.column}=? WHERE id=?`).run(scenario.value, fixture.id);
    assertDayVisibility(fixture, null, false, "anonymous exclusion");
    assertDayVisibility(fixture, viewer, false, "member exclusion");
  });
}

test("empty bounded pages advance their cursor and leave unproved presence unknown", () => {
  const city = "Calendar Backlog";
  db.exec("BEGIN");
  for (let index = 0; index < 5001; index += 1) event({ id: `calendar_backlog_a_${String(index).padStart(5, "0")}`, city, status: "cancelled" });
  const visible = event({ id: "calendar_backlog_z_visible", city });
  db.exec("COMMIT");
  const firstPage = page({ city, date: day(1) });
  assert.deepEqual(firstPage.tourDates, []);
  assert.equal(firstPage.complete, false);
  assert.ok(firstPage.nextCursor);
  assert.equal(firstPage.monthSummary.complete, false);
  assert.equal(Object.hasOwn(firstPage.monthSummary.dayPresence, day(1)), false);
  const continued = page({ city, date: day(1), after: firstPage.nextCursor });
  assert.deepEqual(continued.tourDates.map(({ id }) => id), [visible]);
  assert.equal(continued.complete, true);
});

test("calendar cursors are bound to month, selected period, canonical location and account", () => {
  const query = { month, date: day(15), city: "Paris", country: "FR" };
  const original = tourDateCalendarRequest(query, { viewerId: "member-a" });
  const after = encodeTourDateCalendarCursor({ date: day(15), id: "opaque:event-id" }, original);
  assert.deepEqual(tourDateCalendarRequest({ ...query, after, city: "paris", country: "fr", limit: "25" }, { viewerId: "member-a" }).after,
    { date: day(15), id: "opaque:event-id" });
  for (const patch of [{ month: nextMonth, date: `${nextMonth}-15` }, { date: day(16) }, { date: null, fromDate: day(15) }, { city: "Lyon" }, { country: "US" }]) {
    assert.throws(() => tourDateCalendarRequest({ ...query, ...patch, after }, { viewerId: "member-a" }), TypeError);
  }
  assert.throws(() => tourDateCalendarRequest({ ...query, after }, { viewerId: "member-b" }), TypeError);
  assert.throws(() => page({ after: "invalid-cursor" }), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
});

test("month validation is strict while existing discovery response shapes stay unchanged", () => {
  for (const query of [
    { month: "2026-13" }, { month: "2026-2" }, { month: "2101-01" }, { month: "1899-01" },
    { month, date: `${month}-32` }, { month, date: day(2), fromDate: day(3) },
    { month, days: "30" }, { month, scope: "all-upcoming" }, { month, through: day(20) },
    { month, limit: "0" }, { month, limit: "NaN" }, { month, city: "Paris\nLyon" },
  ]) assert.throws(() => route({ query }), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
  assert.equal(tourDateCalendarRequest({ month: "2000-02" }).through, "2000-02-29");
  assert.equal(tourDateCalendarRequest({ month: "1900-02" }).through, "1900-02-28");
  assert.equal(tourDateCalendarRequest({ month, limit: "9999" }).limit, 500);
  assert.deepEqual(Object.keys(route({})), ["tourDates"]);
  assert.deepEqual(Object.keys(route({ query: { scope: "all-upcoming", limit: "1" } })), ["tourDates", "nextCursor"]);
  assert.deepEqual(Object.keys(route({ query: { days: "30", limit: "1" } })), ["tourDates", "nextCursor", "range"]);
});

test("a shared summary budget never turns unqueried dates into empty dates", () => {
  const range = tourDateCalendarRequest({ month });
  let reads = 0;
  const summary = tourDateCalendarSummary(range, () => {
    reads += 1;
    return { rows: [{ id: "known" }], scanned: 1, nextCursor: "more" };
  }, { rawScanLimit: 2 });
  assert.equal(reads, 2);
  assert.deepEqual(summary, { dayPresence: { [day(1)]: true, [day(2)]: true }, complete: false });
});

test("month API retains later and local events beyond 500 worldwide rows", () => {
  db.exec("BEGIN");
  for (let index = 0; index < 500; index += 1) event({ id: `calendar_integration_a_${String(index).padStart(4, "0")}`, date: day(20), city: "Distant City", countryCode: "US", country: "United States" });
  const homeId = event({ id: "calendar_integration_z_home", date: day(20), city: "Home City", countryCode: "CA", country: "Canada" });
  db.exec("COMMIT");
  const query = { month, date: day(20), limit: "500" };
  const initial = route({ query });
  assert.equal(initial.tourDates.length, 500);
  assert.equal(initial.complete, false);
  assert.equal(initial.monthSummary.dayPresence[day(20)], true);
  const continued = route({ query: { ...query, after: initial.nextCursor } });
  assert.deepEqual(continued.tourDates.map(({ id }) => id), [homeId]);
  assert.equal(continued.complete, true);
  const local = route({ query: { ...query, limit: "100", city: "Home City", country: "CA" } });
  assert.deepEqual(local.tourDates.map(({ id }) => id), [homeId]);
  assert.equal(local.monthSummary.dayPresence[day(20)], true);
  assert.equal(local.complete, true);
});

test("summary and selected rows share canonical, renderable calendar eligibility", () => {
  const city = "Canonical Calendar";
  const legacyId = event({ city, date: day(21).replaceAll("-", " · ") });
  event({ city, date: day(22), artist: "   " });
  event({ city, date: day(23), venue: "   " });
  event({ city, date: day(24), artist: "\u0000" });
  event({ city, date: day(25), venue: "\u0000\t" });
  const result = page({ city, date: day(21) });
  assert.equal(result.tourDates[0].date, day(21));
  assert.deepEqual(result.tourDates.map(({ id }) => id), [legacyId]);
  assert.equal(result.monthSummary.dayPresence[day(21)], true);
  for (const number of [22, 23, 24, 25]) {
    assert.equal(result.monthSummary.dayPresence[day(number)], false);
    assert.deepEqual(page({ city, date: day(number) }).tourDates, []);
  }
  const distantId = event({ city, date: "2100-02-15" });
  const distant = page({ city, month: "2100-02", date: "2100-02-15" });
  assert.deepEqual(distant.tourDates.map(({ id }) => id), [distantId]);
  assert.equal(distant.monthSummary.dayPresence["2100-02-15"], true);
});
