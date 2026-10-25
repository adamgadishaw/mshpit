import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const directory = mkdtempSync(join(tmpdir(), "pit-catalog-search-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("../../db.js");
const { routes } = await import("../../api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const route = routes["GET /api/search/events"];
const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const insert = db.prepare(`INSERT INTO tour_dates(id,artist,venue,place,date,updated_at,source,provider_active,music_qualified,owner_id,release_at,event_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const add = (id, changes = {}) => insert.run(id, changes.artist || "Bon Jovi", changes.venue || "Rogers Stadium", "Toronto, Canada", changes.date || date(100), Date.now(), "ticketmaster", changes.active ?? 1, changes.qualified ?? 1, changes.owner || null, changes.release ?? 0, changes.status || null);
const read = (q, options = {}, user = null) => route({ query: { q, ...options }, user, ip: "catalog-fixture" });

test("query-driven search finds future concerts beyond startup and first matching page with stable continuation", () => {
  for (let i = 0; i < 27; i++) add(`catalog-future-${String(i).padStart(2, "0")}`);
  add("tm_1a8Zk48Je1ZZe8k", { date: "2027-08-04" });
  const startup = routes["GET /api/tourdates"]({ query: { days: "30", limit: "250" } });
  assert.ok(!startup.tourDates.some(row => row.id.startsWith("catalog-future-")));
  const first = read("  BON JOVI  ");
  assert.equal(first.events.length, 24); assert.ok(first.nextCursor);
  const second = read("bon jovi", { after: first.nextCursor });
  const ids = [...first.events, ...second.events].map(row => row.id);
  assert.equal(ids.filter(id => id.startsWith("catalog-future-")).length, 27);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(second.events.some(row => row.id === "tm_1a8Zk48Je1ZZe8k" && row.date === "2027-08-04"));
  assert.equal(second.nextCursor, null);
  assert.equal(read("Rogers Stadium").events.length, 24);
  assert.throws(() => read("different", { after: first.nextCursor }), e => e.status === 400);
  assert.equal(read("bon jovi", { limit: "999" }).events.length, 24);
});

test("public search excludes withdrawn, cancelled, private, unreleased, unqualified and blocked authors even for admins", () => {
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at,profile_audience) VALUES(?,?,?,?,?,?,?)").run("catalog-owner", "catalog@example.test", "Catalog Owner", "catalogowner", "fixture", Date.now(), "everyone");
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES(?,?,?,?,?,?)").run("catalog-viewer", "viewer@example.test", "Catalog Viewer", "catalogviewer", "fixture", Date.now());
  add("catalog-hidden-withdrawn", { artist: "HiddenSearch", active: 0 });
  add("catalog-hidden-cancelled", { artist: "HiddenSearch", status: "cancelled" });
  add("catalog-hidden-unqualified", { artist: "HiddenSearch", qualified: 0 });
  add("catalog-hidden-unreleased", { artist: "HiddenSearch", owner: "catalog-owner", release: Date.now() + 86400000 });
  assert.equal(read("HiddenSearch").events.length, 0);
  assert.equal(read("HiddenSearch", {}, { id: "catalog-owner", role: "admin" }).events.length, 0);
  add("catalog-public-authored", { artist: "AuthoredSearch", owner: "catalog-owner" });
  assert.equal(read("AuthoredSearch").events.length, 1);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run("catalog-viewer", "catalog-owner", Date.now());
  assert.equal(read("AuthoredSearch", {}, { id: "catalog-viewer" }).events.length, 0);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id='catalog-owner'").run();
  assert.equal(read("AuthoredSearch").events.length, 0);
  // Legacy authored records use the existing publication policy. New member-created
  // artist identities also require their public profile's explicit publication.
  db.prepare("UPDATE users SET is_banned=1,profile_audience='everyone' WHERE id='catalog-owner'").run();
  assert.equal(read("AuthoredSearch").events.length, 0);
});

test("search validates bounded query, cursor and page controls, with literal wildcard handling", () => {
  for (const q of ["", "a", "x".repeat(81), "a b c d e f g h i"]) assert.throws(() => read(q), e => e.status === 400);
  for (const options of [{ after: "broken" }, { after: "x".repeat(1001) }, { limit: "0" }, { limit: "1.5" }, { days: "999" }]) assert.throws(() => read("Bon Jovi", options), e => e.status === 400);
  assert.equal(read("%_").events.length, 0);
});

test("catalogue reads do not write data or call providers, and anonymous bursts are rate-limited", () => {
  const before = db.prepare("SELECT total_changes() AS count").get().count;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error("Search must not call a provider"); };
  try { read("Bon Jovi"); read("Rogers"); } finally { globalThis.fetch = previousFetch; }
  assert.equal(db.prepare("SELECT total_changes() AS count").get().count, before);
  for (let i = 0; i < 60; i++) route({ query: { q: "no-match" }, ip: "catalog-rate-fixture" });
  assert.throws(() => route({ query: { q: "no-match" }, ip: "catalog-rate-fixture" }), error => error.status === 429);
});

test("query text is parameterized and cursor payloads cannot select invalid calendar dates or inject SQL", () => {
  const first = read("Bon Jovi");
  const parsed = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8"));
  for (const changes of [{ date: "2027-02-30" }, { id: "\u0000" }, { id: "x".repeat(181) }, { date: null }]) {
    const after = Buffer.from(JSON.stringify({ ...parsed, ...changes })).toString("base64url");
    assert.throws(() => read("Bon Jovi", { after }), error => error.status === 400);
  }
  assert.equal(read("' OR 1=1 --").events.length, 0);
  assert.ok(read("Bon Toronto").events.length > 0);
});

test("search enforces member-created artist publication holds and removed pages", () => {
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES(?,?,?,?,?,?)").run("catalog-publisher", "publisher@example.test", "Search Publisher", "searchpublisher", "fixture", Date.now());
  db.prepare("INSERT INTO artists(norm,name,source,created_at,updated_at) VALUES(?,?,?,?,?)").run("publication search", "Publication Search", "artist-created", Date.now(), Date.now());
  db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,updated_at) VALUES(?,?,?)").run("publication search", "catalog-publisher", Date.now());
  add("catalog-published-page", { artist: "Publication Search", owner: "catalog-publisher" });
  db.prepare("UPDATE tour_dates SET artist_key='publication search' WHERE id='catalog-published-page'").run();
  assert.equal(read("Publication Search").events.length, 1);
  db.prepare("UPDATE artist_profiles SET identity_review_status='pending' WHERE artist_key='publication search'").run();
  assert.equal(read("Publication Search").events.length, 0);
  db.prepare("UPDATE artist_profiles SET identity_review_status='clear',removed=1 WHERE artist_key='publication search'").run();
  assert.equal(read("Publication Search", {}, { id: "catalog-publisher", role: "admin" }).events.length, 0);
});

test("a stored catalogue probe remains a bounded response without hydrating unrelated future rows", (t) => {
  db.exec("BEGIN");
  try {
    for (let i = 0; i < 10000; i++) add(`catalog-budget-${i}`, { artist: "Unrelated Catalogue", venue: "Other Hall" });
    add("catalog-budget-target", { artist: "Budget Probe" });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const start = performance.now();
  const result = read("Budget Probe");
  assert.deepEqual(result.events.map(row => row.id), ["catalog-budget-target"]);
  assert.equal(result.nextCursor, null);
  t.diagnostic(`Stored-query probe with 10,000 unrelated future rows: ${(performance.now() - start).toFixed(1)} ms; one projected row; no provider requests`);
});
