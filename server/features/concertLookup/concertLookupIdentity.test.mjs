import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { clean } from "../../../src/domain/validation.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-lookup-identity-"));
process.env.PIT_DATA_DIR = directory;
const { db, q, artistRow, artistStmts } = await import("../../db.js");
const { concertLookupRoutes } = await import("./concertLookupRoutes.js");
const { ticketmasterRows } = await import("../../tourdates.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const artist = "Lookup Act", artistKey = "lookup act", otherKey = "lookup act namesake", date = "2018-04-20";
const at = Date.now();
q.insertUser.run("identity_viewer", "identity@example.test", "Viewer", "identityviewer", "hash", "fan", "Toronto", 43, -79, "IV", "#123456", at);
const user = q.userById.get("identity_viewer");
beforeEach(() => {
  db.exec("DELETE FROM tour_dates; DELETE FROM artist_profiles; DELETE FROM provider_artist_identities; DELETE FROM artists");
  artistStmts.upsert.run(artistRow(artistKey, { name: artist }, "test"));
});
const attraction = (id = "artist_provider", name = artist) => ({ id, name, classifications: [{ segment: { name: "Music" } }] });
const event = (id = "identity-event", attractions = [attraction()]) => ({
  id, name: `${artist} Live`, classifications: [{ segment: { name: "Music" } }],
  dates: { start: { localDate: date, localTime: "20:00:00", dateTime: "2018-04-21T00:00:00Z" } },
  _embedded: { attractions, venues: [{ name: "Identity Room", city: { name: "Toronto" }, state: { name: "Ontario" }, country: { name: "Canada" } }] },
});
const payload = events => ({ _embedded: { events }, page: { totalPages: 1 } });
function mapping(key = artistKey, id = "artist_provider") {
  db.prepare(`INSERT INTO provider_artist_identities(provider,provider_id,artist_key,provider_name,created_at,last_seen_at)
    VALUES('ticketmaster',?,?,?,?,?)`).run(id, key, artist, at, at);
}
function fixture(events = [event()], { fetchImpl } = {}) {
  let calls = 0;
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const read = concertLookupRoutes({ database: db, ApiError, clean, requireUser: ctx => ctx.user, rateLimit() {},
    apiKey: () => "synthetic-fixture-key", fetchImpl: async (...args) => { calls += 1; return fetchImpl ? fetchImpl(...args) : Response.json(payload(events)); },
  })["GET /api/concerts/lookup"];
  return { read: (extra = {}) => read({ user, query: { artist, artistKey, city: "Toronto", date, source: "ticketmaster", ...extra } }), calls: () => calls };
}
const changes = () => db.prepare("SELECT total_changes() n").get().n;
test("explicit same-name multi-attraction conflict never gains a requested artist key", async () => {
  const events = [event("ambiguous", [attraction("artist_a"), attraction("artist_b")])];
  assert.equal(ticketmasterRows(payload(events), { requestedArtist: artist })[0].artist_identity_status, "conflict");
  const f = fixture(events), before = changes();
  assert.deepEqual((await f.read()).matches, []);
  assert.deepEqual((await f.read()).matches, []);
  assert.equal(f.calls(), 1); assert.equal(changes(), before);
});
test("an exact provider mapping to a different same-named artist cannot be rebound", async () => {
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test")); mapping(otherKey);
  const before = changes();
  assert.deepEqual((await fixture().read()).matches, []);
  assert.equal(changes(), before);
  assert.equal(db.prepare("SELECT artist_key FROM provider_artist_identities").get().artist_key, otherKey);
});
test("a matching exact provider mapping remains selectable even with a catalog namesake", async () => {
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test")); mapping();
  const f = fixture(), before = changes(), result = await f.read();
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].artistKey, artistKey);
  assert.ok(result.matches[0].archiveShowKey); await f.read();
  assert.equal(f.calls(), 1); assert.equal(changes(), before);
});
test("legacy fallback remains available only for an unambiguous unmapped catalog identity", async () => {
  const before = changes(); assert.equal((await fixture().read()).matches.length, 1); assert.equal(changes(), before);
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test"));
  assert.deepEqual((await fixture().read()).matches, []);
  assert.deepEqual((await fixture().read({ artistKey: null })).matches, []);
});
test("separate events with different unregistered same-name provider IDs cannot establish a legacy binding", async () => {
  assert.deepEqual((await fixture([event("a", [attraction("artist_a")]), event("b", [attraction("artist_b")])]).read()).matches, []);
});
test("legacy missing-ID billing cannot bypass an existing canonical provider mapping", async () => {
  mapping();
  assert.deepEqual((await fixture([event("missing", [{ name: artist }])]).read()).matches, []);
  assert.deepEqual((await fixture([event("different-id", [attraction("other_id")])]).read()).matches, []);
});
test("cached positive result is revalidated when mappings change or are removed", async () => {
  mapping(); const f = fixture(); assert.equal((await f.read()).matches.length, 1);
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test"));
  db.prepare("UPDATE provider_artist_identities SET artist_key=?").run(otherKey);
  let before = changes(); assert.deepEqual((await f.read()).matches, []); assert.equal(changes(), before);
  db.prepare("UPDATE provider_artist_identities SET artist_key=?").run(artistKey);
  assert.equal((await f.read()).matches.length, 1);
  db.prepare("DELETE FROM provider_artist_identities").run();
  db.prepare("DELETE FROM artists WHERE norm=?").run(otherKey);
  before = changes(); assert.deepEqual((await f.read()).matches, []); assert.equal(changes(), before);
  assert.equal(f.calls(), 1);
});
test("cached legacy eligibility cannot survive new ambiguous catalog rows or a new conflicting mapping", async () => {
  const f = fixture(); assert.equal((await f.read()).matches.length, 1);
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test"));
  assert.deepEqual((await f.read()).matches, []);
  mapping(otherKey); assert.deepEqual((await f.read()).matches, []); assert.equal(f.calls(), 1);
});
test("an in-flight lookup checks the mapping at completion, before offering or caching a result", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture([], { fetchImpl: () => pending }), response = f.read();
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test")); mapping(otherKey);
  const before = changes(); release(Response.json(payload([event()])));
  assert.deepEqual((await response).matches, []);
  assert.deepEqual((await f.read()).matches, []); assert.equal(changes(), before);
});
test("an existing retained event hold cannot be bypassed through a fresh or cached provider response", async () => {
  const f = fixture(); assert.equal((await f.read()).matches.length, 1);
  db.prepare(`INSERT INTO tour_dates(id,artist,venue,date,source,updated_at,artist_identity_status)
    VALUES('tm_identity-event',?,'Identity Room',?,'ticketmaster',?,'pending')`).run(artist, date, at);
  assert.deepEqual((await f.read()).matches, []);
  assert.deepEqual((await fixture().read()).matches, []);
});

test("Unicode billing aliases retain raw provider IDs for conflict checks even without a primary-artist ID", async () => {
  const name = "Mötley Crüe", key = "motley crue", namesake = "motley namesake";
  artistStmts.upsert.run(artistRow(key, { name }, "test"));
  const events = [event("alias", [attraction("motley_id", "Motley Crue")])];
  assert.equal(ticketmasterRows(payload(events), { requestedArtist: name })[0].provider_artist_id, null);
  const query = { artist: name, artistKey: key };
  assert.equal((await fixture(events).read(query)).matches.length, 1, "unambiguous legacy spelling remains usable");
  mapping(key, "motley_id");
  const f = fixture(events);
  assert.equal((await f.read(query)).matches[0].artistKey, key);
  artistStmts.upsert.run(artistRow(namesake, { name }, "test"));
  db.prepare("UPDATE provider_artist_identities SET artist_key=? WHERE provider_id='motley_id'").run(namesake);
  const before = changes();
  assert.deepEqual((await f.read(query)).matches, []);
  assert.deepEqual((await fixture(events).read(query)).matches, []);
  assert.equal(changes(), before);
});

test("provider IDs remain case-sensitive and unkeyed queries cannot choose among namesakes", async () => {
  artistStmts.upsert.run(artistRow(otherKey, { name: artist }, "test"));
  mapping(artistKey, "ArtistID"); mapping(otherKey, "artistid");
  assert.equal((await fixture([event("upper", [attraction("ArtistID")])]).read()).matches[0].artistKey, artistKey);
  assert.deepEqual((await fixture([event("lower", [attraction("artistid")])]).read()).matches, []);
  assert.deepEqual((await fixture([event("unknown-case", [attraction("ARTISTID")])]).read()).matches, []);
  assert.deepEqual((await fixture([event("upper", [attraction("ArtistID")])]).read({ artistKey: null })).matches, []);
});

test("identity holds and removed profiles invalidate matching mappings and cached legacy results", async () => {
  const legacy = fixture(); assert.equal((await legacy.read()).matches.length, 1);
  db.prepare(`INSERT INTO artist_profiles(artist_key,owner_id,identity_review_status,updated_at)
    VALUES(?,?,'pending',?)`).run(artistKey, user.id, at);
  assert.deepEqual((await legacy.read()).matches, []);
  mapping();
  const f = fixture(); assert.deepEqual((await f.read()).matches, []);
  db.prepare("UPDATE artist_profiles SET identity_review_status='clear'").run();
  const clear = fixture(); assert.equal((await clear.read()).matches.length, 1);
  db.prepare("UPDATE artist_profiles SET removed=1").run();
  const before = changes();
  assert.deepEqual((await clear.read()).matches, []);
  assert.deepEqual((await fixture().read()).matches, []); assert.equal(changes(), before);
});

test("retained canonical conflicts cannot be rebound by mapped or legacy manual lookups", async () => {
  artistStmts.upsert.run(artistRow(otherKey, { name: "Another Act" }, "test"));
  db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,date,source,updated_at)
    VALUES('tm_identity-event',?,?,'Identity Room',?,'ticketmaster',?)`).run(artist, otherKey, date, at);
  const before = changes();
  assert.deepEqual((await fixture().read()).matches, []);
  assert.deepEqual((await fixture().read({ artistKey: null })).matches, []);
  assert.equal(changes(), before);
  mapping();
  assert.deepEqual((await fixture().read()).matches, []);
  assert.deepEqual((await fixture().read({ artistKey: null })).matches, []);
});

test("provider-created or owner-created identities cannot fall back to a missing mapping", async () => {
  for (const source of ["ticketmaster-attraction", "artist-created"]) {
    db.prepare("UPDATE artists SET source=? WHERE norm=?").run(source, artistKey);
    assert.deepEqual((await fixture().read()).matches, []);
  }
});
