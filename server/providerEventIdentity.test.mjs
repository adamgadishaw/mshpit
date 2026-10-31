import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { canonicalProviderEventId, canonicalProviderEventSql, installProviderEventIdentitySql,
  providerPerformanceKey, reviewedEventTimes } from "./providerEventIdentity.js";
import { publicTourDateProviderFields } from "./tourDateMetadata.js";

const row = (overrides = {}) => ({ id: "a", owner_id: null, source: "ticketmaster", artist: "Artist",
  venue: "Room", place: "City, Country", date: "2026-10-30", start_date_time: "2026-10-30T20:00:00Z",
  ticket_url: "https://www.ticketmaster.co.uk/event/123", event_name: "Artist", event_status: "onsale",
  event_kind: "concert", provider_active: 1, music_qualified: 1, release_at: 0,
  start_local_time: null, event_timezone: null, access_start_date_time: null, ...overrides });
const south = (id) => row({ id, artist: "The South", event_name: "The South", venue: "The Brook", place: "Southampton, Great Britain" });

test("a shared single-sale URL and performance time identify provider duplicates", () => {
  assert.equal(providerPerformanceKey(row()), providerPerformanceKey(row({ id: "b", source: "bandsintown",
    ticket_url: "https://ticketmaster.co.uk/event/123?utm_source=bit&camefrom=feed" })));
});

test("nearby or separate performances and ambiguous evidence remain distinct", () => {
  const original = providerPerformanceKey(row());
  for (const change of [{ start_date_time: "2026-10-30T19:30:00Z" }, { ticket_url: "https://www.ticketmaster.co.uk/event/456" },
    { ticket_url: "https://www.ticketmaster.co.uk/event/123?performance=2" }, { place: "Another City" },
    { artist: "Other Artist" }, { venue: "Other Room" }, { event_name: "Artist - Late Show" },
    { owner_id: "member" }, { event_kind: "festival" }, { start_date_time: null },
    { ticket_url: "https://www.ticketmaster.co.uk/artist/123" }, { ticket_url: "https://evil.test/event/123" }]) {
    assert.notEqual(providerPerformanceKey(row(change)), original, JSON.stringify(change));
  }
  for (const start_date_time of ["2026-10-30", "2026-10-30T20:00:00", "2026-10-30T20:00", "2026-13-30T20:00:00Z", "2026-02-30T20:00:00Z"]) {
    assert.equal(providerPerformanceKey(row({ start_date_time })), "", start_date_time);
  }
  assert.equal(providerPerformanceKey(row({ start_date_time: "2026-10-30T21:00:00+01:00" })), original);
});

test("reviewed doors and start evidence is bounded to the exact performance", () => {
  assert.deepEqual(reviewedEventTimes(null), {});
  const a = south("tm_16wZk8IvsZA5v122"), b = south("tm_LvZ18QnJ_3ZBENPibGAjN");
  b.start_date_time = "2026-10-30T19:30:00Z";
  assert.equal(providerPerformanceKey(a), providerPerformanceKey(b));
  const times = publicTourDateProviderFields(a);
  assert.equal(times.startDateTime, "2026-10-30T20:00:00.000Z");
  assert.equal(times.accessStartDateTime, "2026-10-30T19:30:00.000Z");
  assert.equal(times.accessStartApproximate, false);
  for (const change of [{ date: "2027-10-30" }, { artist: "Other Artist" }, { venue: "Other Room" },
    { owner_id: "member" }, { place: "Other City" }, { id: "unreviewed" },
    { event_status: "rescheduled" }, { event_status: "postponed" }, { event_status: "cancelled" },
    { start_local_time: "21:00:00" }, { event_timezone: "Europe/Paris" }, { access_start_date_time: "2026-10-30T20:30:00Z" },
    { start_date_time: "2026-10-30T21:00:00Z" }, { start_date_time: "2026-10-30T20:00:00" }]) {
    assert.deepEqual(reviewedEventTimes({ ...a, ...change }), {});
  }
});

test("SQL collections and direct alias resolution agree without changing stored rows", () => {
  const database = new DatabaseSync(":memory:");
  installProviderEventIdentitySql(database);
  const a = south("tm_16wZk8IvsZA5v122"), b = south("tm_LvZ18QnJ_3ZBENPibGAjN");
  b.start_date_time = "2026-10-30T19:30:00Z";
  const fields = Object.keys(a);
  database.exec(`CREATE TABLE tour_dates (${fields.map((field) => `${field} ${["owner_id", "release_at", "provider_active", "music_qualified"].includes(field) ? "" : "TEXT"}`).join(",")})`);
  const insert = database.prepare(`INSERT INTO tour_dates VALUES (${fields.map(() => "?").join(",")})`);
  for (const value of [a, b, row({ id: "late", start_date_time: "2026-10-30T22:00:00Z" }), row({ id: "early" })]) insert.run(...fields.map((field) => value[field]));
  const ids = () => database.prepare(`SELECT td.id FROM tour_dates td WHERE ${canonicalProviderEventSql()} ORDER BY td.id`).all().map((value) => value.id);
  assert.deepEqual(ids(), ["early", "late", a.id]);
  assert.equal(canonicalProviderEventId(database, b.id), a.id);
  database.prepare("UPDATE tour_dates SET release_at=100 WHERE id=?").run(a.id);
  const idsAt = (at) => database.prepare(`SELECT td.id FROM tour_dates td WHERE td.release_at<=?1 AND ${canonicalProviderEventSql("td", null, "?1")} ORDER BY td.id`).all(at).map((value) => value.id);
  assert.deepEqual(idsAt(200), ["early", "late", a.id], "different release timestamps share one canonical once both are released");
  assert.deepEqual(idsAt(50), ["early", "late", b.id], "an unreleased representative cannot suppress the released listing");
  assert.equal(canonicalProviderEventId(database, b.id, 200), a.id);
  assert.equal(canonicalProviderEventId(database, b.id, 50), b.id);
  database.prepare("UPDATE tour_dates SET release_at=0 WHERE id=?").run(a.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM tour_dates").get().n, 4);
  assert.equal(database.prepare("SELECT start_date_time FROM tour_dates WHERE id=?").get(b.id).start_date_time, b.start_date_time);
  database.prepare("UPDATE tour_dates SET provider_active=0 WHERE id=?").run(a.id);
  assert.ok(ids().includes(b.id), "an inactive winner cannot hide an active alias");
  database.prepare("UPDATE tour_dates SET provider_active=1 WHERE id=?").run(a.id);
  database.prepare("UPDATE tour_dates SET release_at=1000 WHERE id=?").run(b.id);
  assert.equal(canonicalProviderEventId(database, b.id, 100), b.id, "unreleased aliases cannot borrow public access");
  database.prepare("UPDATE tour_dates SET release_at=0,music_qualified=0 WHERE id=?").run(b.id);
  assert.equal(canonicalProviderEventId(database, b.id), b.id, "unqualified aliases cannot borrow public access");
  database.close();
});
