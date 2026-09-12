import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { canonicalProfileExtras } from "./profileExtras.js";
import { concertMapVisibleFor } from "./profilePreferences.js";
import { trustedCityVenues } from "./features/cities/citySchema.js";
import { publicProfileCacheEntry, sanitizePersistedStoreValue } from "../src/domain/dataPolicy.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-concert-map-preference-"));
process.env.PIT_DATA_DIR = directory;
const { db, q, publicUser } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
function user(extras = {}) {
  const id = `u_map_preference_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, "Map Fan", id, "test-hash", "fan", "Toronto", 43.65, -79.38, "MF", "#123456", Date.now());
  db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify(extras), id);
  return q.userById.get(id);
}
const patch = (account, body, extra = {}) => routes["PATCH /api/me"]({ user: account, body, ip: "127.0.0.1", ...extra });

test("concert map preference defaults visible for existing and new accounts without a migration", () => {
  const account = user();
  assert.equal(publicUser(account).concertMapVisible, true);
  assert.equal(publicUser(account, { self: true }).concertMapVisible, true);
  assert.equal(JSON.parse(q.userById.get(account.id).extras).concertMapVisible, undefined);
});

test("map visibility is a confirmed boolean preference preserving every other stored profile field", () => {
  const extras = { theme: "forest", analyticsOptOut: true, termsAcceptedAt: 100, termsVersion: "test", searchIndexingOptOut: true };
  let account = user(extras);
  const before = { ...account };
  for (const visible of [false, false, true]) {
    const result = patch(account, { concertMapVisible: visible });
    assert.equal(result.user.concertMapVisible, visible);
    account = q.userById.get(account.id);
    assert.deepEqual(JSON.parse(account.extras), { ...extras, concertMapVisible: visible });
    assert.equal(account.name, before.name);
    assert.equal(account.home_lat, before.home_lat);
    assert.equal(account.profile_audience, before.profile_audience);
    assert.equal(publicUser(account).concertMapVisible, visible);
    assert.equal(publicUser(account, { self: true }).concertMapVisible, visible, "self-service/export uses the same projection");
  }
});

test("generic extras and unrelated profile writes cannot erase or forge the map visibility choice", () => {
  let account = user({ concertMapVisible: false, theme: "forest", analyticsOptOut: true });
  for (const body of [{ name: "Renamed Fan" }, { theme: "neon" }, { extras: { theme: "forest" } }, { extras: { concertMapVisible: true } }]) {
    patch(account, body);
    account = q.userById.get(account.id);
    assert.equal(publicUser(account).concertMapVisible, false);
  }
  patch(account, { extras: { theme: "forest" }, concertMapVisible: true });
  assert.equal(publicUser(q.userById.get(account.id)).concertMapVisible, true);
});

test("malformed map preferences reject atomically and guest writes remain unauthorized", () => {
  const account = user({ concertMapVisible: false });
  for (const value of [null, "false", 0, 1, {}, []]) {
    const before = { ...q.userById.get(account.id) };
    assert.throws(() => patch(account, { name: "Must not save", concertMapVisible: value }), (error) => error instanceof ApiError && error.status === 400);
    assert.deepEqual({ ...q.userById.get(account.id) }, before);
  }
  assert.throws(() => patch(null, { concertMapVisible: true }), { status: 401, code: "AUTH_REQUIRED" });
  assert.throws(() => patch(account, { concertMapVisible: true }, { assertCurrentSession: () => { throw new ApiError(401, "Expired", "AUTH_REQUIRED"); } }), { status: 401 });
  assert.equal(publicUser(q.userById.get(account.id)).concertMapVisible, false);
});

test("public preference projection and cache preserve false without leaking private account metadata", () => {
  const account = user({ concertMapVisible: false, analyticsOptOut: true, termsAcceptedAt: 100, searchIndexingOptOut: true });
  const response = routes["GET /api/users/:id"]({ user: null, params: { id: account.id }, query: {} }).user;
  assert.equal(response.concertMapVisible, false);
  for (const key of ["email", "extras", "analyticsOptOut", "termsAcceptedAt", "searchIndexingOptOut", "password_hash"]) assert.equal(Object.hasOwn(response, key), false);
  assert.equal(publicProfileCacheEntry(response).concertMapVisible, false);
  assert.equal(sanitizePersistedStoreValue("pit.users", [response])[0].concertMapVisible, false);
  for (const invalid of ["false", {}, []]) assert.equal(Object.hasOwn(publicProfileCacheEntry({ id: account.id, concertMapVisible: invalid }), "concertMapVisible"), false);
  assert.deepEqual(canonicalProfileExtras({ concertMapVisible: false }, { strict: true }), { valid: true, value: { concertMapVisible: false } });
});

test("legacy or malformed preference envelopes use the documented visible default", () => {
  for (const extras of [undefined, null, "", "not JSON", "null", "[]", '{"concertMapVisible":"false"}']) {
    assert.equal(concertMapVisibleFor({ extras }), true);
  }
  assert.equal(concertMapVisibleFor({ extras: '{"concertMapVisible":false}' }), false);
});

const venue = trustedCityVenues().find((entry) => typeof entry.lat === "number" && typeof entry.lng === "number"
  && entry.lat !== 0 && entry.lng !== 0 && entry.countryCode && entry.country && entry.name && entry.city);
assert.ok(venue, "the real catalog must contain a mapped venue for the privacy control");
function concert(account, suffix, createdAt) {
  const id = `p_map_${account.id}_${suffix}`;
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,venue_key,city,date,overall,review,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, account.id, "Public Artist", venue.name, venue.key, venue.city, "2025-05-01", 4, "Existing public concert review", "review", createdAt);
  return id;
}
const history = (account, viewer = null, query = {}) => routes["GET /api/users/:id/concert-history"]({
  user: viewer, params: { id: account.id }, query, ip: "127.0.0.1", setHeader() {},
});

test("actual history route removes map metadata immediately after opt-out, including an already-issued cursor and owner reads", () => {
  const account = user(), visitor = user();
  concert(account, "first", 200);
  const nextId = concert(account, "second", 100);
  const first = history(account, null, { limit: "1" });
  assert.equal(first.mapVisible, true);
  assert.equal(first.concerts[0].lat, venue.lat);
  assert.equal(first.concerts[0].countryCode, venue.countryCode);
  assert.ok(first.nextCursor);
  const stored = db.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY id").all(account.id);
  patch(account, { concertMapVisible: false });
  for (const viewer of [null, visitor, account]) {
    const response = history(account, viewer, { limit: "1", before: first.nextCursor });
    assert.equal(response.mapVisible, false);
    assert.equal(response.coverage.unmappedCount, null);
    assert.equal(response.coverage.includesPrivateAttendance, false);
    assert.equal(response.concerts.length, 1);
    assert.equal(response.concerts[0].id, nextId);
    for (const key of ["lat", "lng", "country", "countryCode"]) assert.equal(response.concerts[0][key], null);
    assert.equal(response.concerts[0].venue, venue.name);
    assert.equal(response.concerts[0].city, venue.city, "authored public concert list is preserved");
  }
  assert.deepEqual(db.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY id").all(account.id), stored);
  patch(q.userById.get(account.id), { concertMapVisible: true });
  assert.equal(history(account).concerts[0].lat, venue.lat);
});

test("actual history endpoint follows profile audience for guests, members and the owner", () => {
  const account = user(), visitor = user();
  concert(account, "audience", 100);
  assert.equal(history(account).concerts.length, 1);
  db.prepare("UPDATE users SET profile_audience='members' WHERE id=?").run(account.id);
  assert.throws(() => history(account), { status: 404, code: "NOT_FOUND" });
  assert.equal(history(account, visitor).concerts.length, 1);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(account.id);
  assert.throws(() => history(account, visitor), { status: 404, code: "NOT_FOUND" });
  assert.equal(history(account, account).concerts.length, 1);
});

test("actual history cursor never bypasses current blocks or restricted author visibility", () => {
  const account = user(), visitor = user();
  concert(account, "new", 200); concert(account, "old", 100);
  const { nextCursor } = history(account, visitor, { limit: "1" });
  for (const [blocker, blocked] of [[account, visitor], [visitor, account]]) {
    db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(blocker.id, blocked.id, Date.now());
    assert.throws(() => history(account, visitor, { before: nextCursor }), { status: 404, code: "NOT_FOUND" });
    db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(blocker.id, blocked.id);
  }
  for (const [column, value, reset] of [["is_banned", 1, 0], ["suspended_until", Date.now() + 60_000, null], ["dormant_at", Date.now(), null]]) {
    db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(value, account.id);
    for (const viewer of [null, visitor, account]) assert.throws(() => history(account, viewer, { before: nextCursor }), { status: 404, code: "NOT_FOUND" });
    db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(reset, account.id);
  }
});

test("actual history cursors remain target-bound and public rows expose only the compact contract", () => {
  const account = user(), other = user();
  concert(account, "new", 200); concert(account, "old", 100); concert(other, "other", 100);
  const response = history(account, null, { limit: "1" });
  assert.throws(() => history(other, null, { before: response.nextCursor }), { status: 400 });
  assert.deepEqual(Object.keys(response.concerts[0]).sort(), ["id", "postId", "artist", "venue", "venueKey", "city", "date", "rating", "photo", "lat", "lng", "countryCode", "country"].sort());
  assert.equal(response.concerts[0].photo, null);
});
