import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { clean } from "../../../src/domain/validation.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-concert-lookup-"));
process.env.PIT_DATA_DIR = directory;
const { db, q, artistRow, artistStmts } = await import("../../db.js");
const { routes } = await import("../../api.js");
const { concertLookupRoutes } = await import("./concertLookupRoutes.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
const at = Date.now();
function member() {
  const id = `lookup_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "hash", "fan", "Toronto", 43, -79, "LU", "#123456", at);
  return q.userById.get(id);
}
const viewer = member(), author = member();
const artist = "Lookup Act", artistKey = "lookup act", date = "2018-04-20", city = "Toronto, Ontario, Canada";
artistStmts.upsert.run(artistRow(artistKey, { name: artist }, "test"));
const query = { artist, artistKey, date, city };
const ctx = (extra = {}, user = viewer) => ({ user, ip: user.id, query: { ...query, ...extra } });
const lookup = (extra, user) => routes["GET /api/concerts/lookup"](ctx(extra, user));
function event(id, changes = {}) {
  const row = { id, artist, artist_key: artistKey, venue: "Lookup Hall", place: city, date, source: "ticketmaster", updated_at: at, ...changes };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO tour_dates (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
}
function review(venue, user = author, changes = {}) {
  return routes["POST /api/posts"]({ user, ip: user.id,
    body: { artist, artistKey, date, city, venue, overall: 4.5, review: "Authored review remains private to its scope", ...changes } });
}
test("historical inactive catalog and review matches are available without a future-only cutoff or writes", async () => {
  event("tm_lookup", { provider_active: 0 });
  review("Lookup Hall");
  review("Community Room");
  const before = db.prepare("SELECT COUNT(*) count FROM tour_dates").get().count;
  const result = await lookup();
  assert.deepEqual(result.matches.map(row => row.venue), ["Community Room", "Lookup Hall"]);
  assert.equal(result.matches[1].eventId, "tm_lookup");
  assert.ok(result.matches.every(row => row.archiveShowKey && row.artistKey === artistKey));
  assert.ok(result.matches.every(row => !Object.hasOwn(row, "review") && !Object.hasOwn(row, "userId")));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tour_dates").get().count, before);
});
test("lookup excludes removed, online, blocked, private, inactive-account and unreleased facts", async () => {
  const hidden = member();
  const saved = review("Private Room", hidden);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(hidden.id);
  assert.equal((await lookup()).matches.some(row => row.venue === "Private Room"), false);
  assert.equal((await lookup({}, hidden)).matches.some(row => row.venue === "Private Room"), true);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(hidden.id);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(hidden.id, viewer.id, at);
  assert.equal((await lookup()).matches.some(row => row.venue === "Private Room"), false);
  db.prepare("DELETE FROM blocks WHERE blocker_id=?").run(hidden.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(hidden.id);
  assert.equal((await lookup()).matches.some(row => row.venue === "Private Room"), false);
  db.prepare("UPDATE users SET is_banned=0 WHERE id=?").run(hidden.id);
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(saved.id);
  assert.equal((await lookup()).matches.some(row => row.venue === "Private Room"), false);
  event("future_release", { venue: "Unreleased Room", owner_id: viewer.id, release_at: at + 100000 });
  event("cancelled_lookup", { venue: "Cancelled Room", event_status: "cancelled" });
  event("wrong_key", { venue: "Namesake Room", artist_key: null, artist_identity_status: "conflict" });
  assert.equal((await lookup()).matches.some(row => /Unreleased|Cancelled|Namesake/.test(row.venue)), false);
  db.prepare("UPDATE posts SET removed=0,experience_type='online' WHERE id=?").run(saved.id);
  assert.equal((await lookup()).matches.some(row => row.venue === "Private Room"), false);
});
test("selected catalog fields persist through normal create/retry/edit with the same archive association", async () => {
  const match = (await lookup()).matches.find(row => row.venue === "Lookup Hall");
  const body = { artist: match.artist, artistKey: match.artistKey, venue: match.venue, date: match.date, city: match.city,
    overall: 4.5, review: "Selected concert", clientMutationId: "concert_lookup_retry_001" };
  const context = { user: viewer, ip: "selection", body };
  const saved = routes["POST /api/posts"](context);
  assert.equal(saved.post.archiveShowKey, match.archiveShowKey);
  assert.equal(routes["POST /api/posts"](context).id, saved.id);
  const edited = routes["PATCH /api/posts/:id"]({ user: viewer, ip: "selection", params: { id: saved.id }, body: { review: "Updated text" } });
  assert.equal(edited.post.archiveShowKey, match.archiveShowKey);
  assert.equal(edited.post.artistKey, artistKey);
});
test("literal dates and mismatched canonical artist keys fail safely", async () => {
  for (const value of ["2018-02-30", "2018-4-20", "2018-04-20T00:00:00Z", ""]) await assert.rejects(lookup({ date: value }), /calendar date/);
  await assert.rejects(lookup({ artistKey: "wrong" }), /artist again/);
  assert.deepEqual((await lookup({ city: "London" })).matches, []);
  assert.deepEqual((await lookup({ city: "Toronto, Ohio, United States" })).matches, []);
});
function providerEvent(id = "external", changes = {}) {
  return { id, name: `${artist} Tour`, url: "https://www.ticketmaster.com/event/123", classifications: [{ segment: { name: "Music" } }],
    dates: { start: { localDate: date, localTime: "20:00:00", dateTime: "2018-04-21T00:00:00Z" }, status: { code: "offsale" } },
    _embedded: { venues: [{ name: "External Hall", city: { name: "Toronto" }, state: { name: "Ontario" }, country: { name: "Canada" }, timezone: "America/Toronto" }],
      attractions: [{ id: "artist_provider", name: artist, classifications: [{ segment: { name: "Music" } }] }] }, ...changes };
}
function provider(fetchImpl, key = "test-not-a-credential") {
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  return concertLookupRoutes({ database: db, ApiError, requireUser: context => context.user, rateLimit() {}, clean,
    apiKey: () => key, fetchImpl })["GET /api/concerts/lookup"];
}
test("Ticketmaster uses local calendar bounds, billing identity, bounded response and provider-only cache", async () => {
  const calls = [];
  const reader = provider(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json({ page: { totalPages: 1 }, _embedded: { events: [providerEvent(),
      providerEvent("tribute", { _embedded: { ...providerEvent()._embedded, attractions: [{ name: "Tribute to Lookup Act" }] } }),
      providerEvent("wrong-day", { dates: { start: { localDate: "2018-04-21" } } })] } });
  });
  const result = await reader(ctx({ source: "ticketmaster" }));
  assert.deepEqual(result.matches.map(row => row.eventId), ["tm_external"]);
  assert.equal(result.matches[0].date, date);
  assert.equal(calls[0].url.searchParams.get("localStartDateTime"), `${date}T00:00:00,${date}T23:59:59`);
  assert.equal(calls[0].url.searchParams.has("startDateTime"), false);
  assert.equal(calls[0].url.searchParams.get("city"), "Toronto");
  assert.equal(calls[0].url.searchParams.get("keyword"), artist);
  assert.ok(calls[0].options.signal);
  await reader(ctx({ source: "ticketmaster" }, author));
  assert.equal(calls.length, 1);
});
test("missing configuration, provider errors and oversized bodies preserve the independent catalog path", async () => {
  assert.equal((await provider(() => { throw new Error("must not call"); }, "")(ctx({ source: "ticketmaster" }))).status, "unavailable");
  for (const response of [new Response("unavailable", { status: 503 }), new Response("{}", { headers: { "content-length": "999999999" } })]) {
    const result = await provider(async () => response)(ctx({ source: "ticketmaster" }));
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.matches, []);
    assert.ok((await lookup()).matches.length);
  }
});
test("both recently elapsed and old dates remain literal even when provider UTC date differs", async () => {
  for (const localDate of ["2018-04-20", "2026-11-10"]) {
    const reader = provider(async url => {
      assert.equal(new URL(url).searchParams.get("localStartDateTime"), `${localDate}T00:00:00,${localDate}T23:59:59`);
      return Response.json({ _embedded: { events: [providerEvent("late-show", {
        dates: { start: { localDate, localTime: "23:30:00", dateTime: `${localDate.slice(0, 8)}${String(Number(localDate.slice(8)) + 1).padStart(2, "0")}T04:30:00Z` } },
      })] }, page: { totalPages: 1 } });
    });
    assert.equal((await reader(ctx({ source: "ticketmaster", date: localDate }))).matches[0].date, localDate);
  }
});
test("provider throttling is respected without an automatic retry or a burst on another query", async () => {
  let calls = 0;
  const reader = provider(async () => { calls += 1; return new Response("throttled", { status: 429, headers: { "Retry-After": "3600" } }); });
  assert.equal((await reader(ctx({ source: "ticketmaster" }))).status, "unavailable");
  assert.equal((await reader(ctx({ source: "ticketmaster", city: "London" }))).status, "busy");
  assert.equal(calls, 1);
});
