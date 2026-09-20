import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PROVIDER_ARTIST_SOURCE, ensureProviderArtistRegistrationSchema,
  registerProviderArtistRows, ticketmasterPrimaryArtistIdentity,
} from "./providerArtistRegistration.js";

const AT = Date.parse("2026-09-20T12:00:00Z"), DAY = 86400000;
function row(name = "Future Performer", id = "Attraction-A", extras = {}) {
  return { artist: name, source: "ticketmaster", music_qualified: 1,
    music_evidence: "ticketmaster:classification:music", billed_artists: [name],
    provider_artist_id: id, provider_artist_name: name, ...extras };
}
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE artists (norm TEXT PRIMARY KEY,name TEXT NOT NULL,public_slug TEXT,search_key TEXT,
      genre TEXT,photo TEXT,bio TEXT,mbid TEXT,spotify_id TEXT,country TEXT,formed TEXT,
      popularity INTEGER,rank_score INTEGER NOT NULL DEFAULT 0,data TEXT,source TEXT,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX artist_slug ON artists(lower(public_slug)) WHERE public_slug IS NOT NULL AND public_slug<>'';
    CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY,owner_id TEXT,bio TEXT,removed INTEGER DEFAULT 0,identity_review_status TEXT DEFAULT 'clear');
    CREATE TABLE tour_dates (id TEXT PRIMARY KEY);`);
  ensureProviderArtistRegistrationSchema(db);
  const register = (rows, options = {}) => registerProviderArtistRows(db, rows, { at: AT, ...options });
  const artists = () => db.prepare("SELECT * FROM artists ORDER BY norm").all();
  const mappings = () => db.prepare("SELECT * FROM provider_artist_identities ORDER BY provider_id").all();
  const budget = () => db.prepare("SELECT * FROM provider_artist_registration_budget").get();
  const existing = (name, fields = {}) => {
    const data = { norm: name.trim().toLowerCase(), name, source: "reviewed-identity", search_key: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
      public_slug: null, created_at: 10, updated_at: 20, ...fields };
    const keys = Object.keys(data);
    db.prepare(`INSERT INTO artists (${keys.join(",")}) VALUES (${keys.map((key) => `@${key}`).join(",")})`).run(data);
  };
  return { db, register, artists, mappings, budget, existing };
}

test("registration is metadata-only, insert-only, idempotent and locally resolvable by name", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.register([row()]), [{ artistKey: "future performer", artistName: "Future Performer", providerArtistId: "Attraction-A", status: "registered" }]);
  const snapshot = f.artists();
  assert.equal(snapshot[0].source, PROVIDER_ARTIST_SOURCE);
  assert.equal(snapshot[0].public_slug, "future-performer");
  assert.equal(snapshot[0].search_key, "futureperformer");
  for (const key of ["mbid", "spotify_id", "photo", "bio", "genre", "country", "formed", "popularity"]) assert.equal(snapshot[0][key], null, key);
  assert.deepEqual(JSON.parse(snapshot[0].data), { name: "Future Performer", providerIdentity: {
    provider: "ticketmaster", id: "Attraction-A", evidence: "ticketmaster:classification:music",
  } });
  assert.equal(f.register([row()], { at: AT + 1000 })[0].status, "registered");
  assert.deepEqual(f.artists(), snapshot);
  assert.equal(f.mappings().length, 1);
  assert.equal(f.budget().total_inserted, 1);
});

test("same-name distinct attraction IDs are quarantined before any batch insert", (t) => {
  const f = fixture(t);
  for (const batch of [[row("Same", "A"), row("same", "B")], [row("Eclair", "A"), row("Éclair", "B")]]) {
    assert.deepEqual(f.register(batch).map((value) => value.status), ["conflict", "conflict"]);
    assert.equal(f.artists().length, 0);
  }
  assert.equal(f.budget().total_inserted, 0);
});

test("a later namesake cannot bind or overwrite the original registered performer", (t) => {
  const f = fixture(t);
  f.register([row()]); const before = f.artists();
  assert.equal(f.register([row("Future Performer", "different-ID")])[0].status, "conflict");
  assert.equal(f.register([{ artist: "Future Performer", source: "bandsintown" }])[0].artistKey, null);
  assert.deepEqual(f.artists(), before);
  assert.equal(f.mappings().length, 1);
});

test("provider IDs are case-sensitive; exact ID rename defers without new identity or alias", (t) => {
  const f = fixture(t);
  f.register([row("Original", "AbC"), row("Different", "abc")]);
  assert.equal(f.mappings().length, 2);
  const before = f.artists();
  assert.deepEqual(f.register([row("Renamed", "AbC")])[0], {
    artistKey: null, artistName: null, providerArtistId: "AbC", status: "pending",
  });
  assert.deepEqual(f.artists(), before);
  assert.equal(f.mappings().find((value) => value.provider_id === "AbC").artist_key, "original");
});

test("same ID with conflicting names in one batch never chooses the first identity", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.register([row("First", "ID"), row("Second", "ID")]).map((value) => value.status), ["pending", "pending"]);
  assert.equal(f.artists().length, 0);
});

test("existing member-created, held and search collisions stay quarantined; imported approved claims retain legacy binding without mapping", (t) => {
  const f = fixture(t);
  f.existing("Member", { source: "artist-created", bio: "Private member biography" });
  f.existing("Held"); f.existing("Claimed"); f.existing("sports.");
  f.db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,identity_review_status) VALUES (?,?,?)").run("held", "owner-a", "pending");
  f.db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,identity_review_status) VALUES (?,?,?)").run("claimed", "owner-b", "approved");
  const before = f.artists();
  const result = f.register([row("Member", "1"), row("Held", "2"), row("Claimed", "3"), row("Sports", "4")]);
  assert.deepEqual(result.map((value) => value.status), ["conflict", "conflict", null, "conflict"]);
  assert.equal(result[2].artistKey, "claimed");
  assert.deepEqual(f.artists(), before); assert.equal(f.mappings().length, 0);
});

test("an approved owner claim does not invalidate an already exact mapped identity", (t) => {
  const f = fixture(t); f.register([row()]);
  f.db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,bio,identity_review_status) VALUES (?,?,?,?)")
    .run("future performer", "owner", "Owner biography", "approved");
  const profile = f.db.prepare("SELECT * FROM artist_profiles").get(), before = f.artists();
  assert.equal(f.register([row()])[0].status, "registered");
  assert.deepEqual(f.artists(), before);
  assert.deepEqual(f.db.prepare("SELECT * FROM artist_profiles").get(), profile);
  f.db.exec("UPDATE artist_profiles SET identity_review_status='pending'");
  assert.equal(f.register([row()])[0].status, "pending");
});

test("legacy imported names keep their existing binding but never gain guessed provider authority", (t) => {
  const f = fixture(t); f.existing("Known", { mbid: "00000000-0000-4000-8000-000000000001" });
  const before = f.artists(), result = f.register([row("Known", "ID")])[0];
  assert.equal(result.artistKey, "known"); assert.equal(result.status, null);
  assert.deepEqual(f.artists(), before); assert.equal(f.mappings().length, 0);
});

test("a reviewed alias retains its unique registry-verified catalogue identity without creating a crosswalk", (t) => {
  const f = fixture(t), mbid = "25b7b584-d952-4662-a8b9-dd8cdfbfeb64";
  f.existing("A$AP Rocky", { mbid }); const before = f.artists();
  const result = f.register([row("ASAP Rocky", "Artist-ID")])[0];
  assert.equal(result.artistKey, "a$ap rocky"); assert.equal(result.status, null);
  assert.equal(f.mappings().length, 0); assert.deepEqual(f.artists(), before);
  assert.equal(f.register([{ ...row("ASAP Rocky"), provider_artist_id: null, provider_artist_name: null }])[0].artistKey, "a$ap rocky");
  f.existing("Another Identity", { mbid });
  assert.equal(f.register([row("ASAP Rocky", "Artist-ID")])[0].status, "pending", "duplicate MBID cannot choose an alias target");
  assert.equal(f.artists().length, 2, "no duplicate alias artist is inserted");
});

test("a recognized alias with its reviewed identity missing remains pending rather than creating another artist", (t) => {
  const f = fixture(t);
  assert.equal(f.register([row("ASAP Rocky", "Artist-ID")])[0].status, "pending");
  assert.equal(f.artists().length, 0); assert.equal(f.mappings().length, 0);
});

test("reviewed aliases cannot bypass an identity hold or a member-created publication boundary", (t) => {
  const f = fixture(t), mbid = "25b7b584-d952-4662-a8b9-dd8cdfbfeb64";
  f.existing("A$AP Rocky", { mbid });
  f.db.prepare("INSERT INTO artist_profiles(artist_key,identity_review_status) VALUES (?,?)").run("a$ap rocky", "pending");
  assert.equal(f.register([row("ASAP Rocky", "Artist-ID")])[0].status, "conflict");
  f.db.exec("DELETE FROM artist_profiles; UPDATE artists SET source='artist-created'");
  assert.equal(f.register([row("ASAP Rocky", "Artist-ID")])[0].status, "conflict");
});

test("legacy missing names, authored rows and invalid provider evidence cannot register artists", (t) => {
  const f = fixture(t);
  const invalid = [
    { artist: "Missing", source: "ticketmaster" }, row("Authored", "A", { owner_id: "owner" }),
    row("Non Music", "B", { music_qualified: 0 }), row("Search Only", "C", { music_evidence: "ticketmaster:artist-search:matched-attraction" }),
    row("Mismatch", "D", { artist: "Requested Other" }), row("Invalid ID", "a/b"), row("<script>", "E"),
  ];
  f.register(invalid);
  assert.equal(f.artists().length, 0); assert.equal(f.budget().total_inserted, 0);
});

test("batch cap is hard and deferred identities recover on a later bounded pass", (t) => {
  const f = fixture(t), rows = Array.from({ length: 41 }, (_, index) => row(`Performer ${index}`, `ID-${index}`));
  const results = f.register(rows, { limits: { maxPerBatch: 1000000 } });
  assert.equal(results.filter((value) => value.status === "registered").length, 40);
  assert.equal(results.at(-1).status, "pending");
  assert.equal(f.register(rows)[40].status, "registered");
  assert.equal(f.budget().total_inserted, 41);
});

test("oversized batches fail before registration and cannot allocate an unbounded candidate ledger", (t) => {
  const f = fixture(t), before = f.budget();
  assert.throws(() => f.register(Array.from({ length: 5001 }, () => row())), /exceeds 5000/);
  assert.equal(f.artists().length, 0); assert.deepEqual(f.budget(), before);
});

test("durable daily and lifetime budgets survive calls, clock rollback and artist deletion", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE provider_artist_registration_budget SET utc_day=?,daily_inserted=999,total_inserted=9998").run("2026-09-20");
  assert.deepEqual(f.register([row("One", "1"), row("Two", "2")]).map((value) => value.status), ["registered", "pending"]);
  assert.equal(f.register([row("Yesterday", "3")], { at: AT - DAY })[0].status, "pending");
  assert.equal(f.register([row("Tomorrow", "4")], { at: AT + DAY })[0].status, "registered");
  f.db.exec("DELETE FROM artists");
  assert.equal(f.register([row("Beyond Total", "5")], { at: AT + 2 * DAY })[0].status, "pending");
  assert.equal(f.budget().total_inserted, 10000);
});

test("all registrations and counters roll back atomically on a failed insert", (t) => {
  const f = fixture(t), budget = f.budget();
  f.db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON artists WHEN NEW.norm='reject' BEGIN SELECT RAISE(ABORT,'test rejection'); END");
  assert.throws(() => f.register([row("Allowed", "1"), row("Reject", "2")]), /test rejection/);
  assert.equal(f.artists().length, 0); assert.equal(f.mappings().length, 0); assert.deepEqual(f.budget(), budget);
});

test("slug collisions use the existing deterministic suffix policy without moving another page", (t) => {
  const f = fixture(t); f.existing("Another", { public_slug: "future-performer" });
  f.register([row()]);
  assert.match(f.artists().find((value) => value.norm === "future performer").public_slug, /^future-performer-[0-9a-f]{10}$/u);
  assert.equal(f.artists().find((value) => value.norm === "another").public_slug, "future-performer");
});

test("absence checks use indexes rather than scanning the artist catalogue", (t) => {
  const f = fixture(t);
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT norm,name,source FROM artists
    WHERE norm=? OR lower(trim(name))=lower(trim(?)) OR search_key=? LIMIT 3`).all("a", "A", "a");
  assert.ok(plan.some((value) => value.detail.includes("idx_artists_trimmed_name_lookup")));
  assert.ok(plan.every((value) => !/SCAN artists/u.test(value.detail)));
});

test("primary attraction extraction rejects title fallback, unrelated requested billing, nonmusic, joint acts and ambiguous IDs", () => {
  const make = (attractions) => ({ _embedded: { attractions } });
  const options = { artist: "Performer", musicEvidence: "ticketmaster:classification:music" };
  assert.deepEqual(ticketmasterPrimaryArtistIdentity(make([{ id: "Exact-ID", name: "Performer" }]), options), { id: "Exact-ID", name: "Performer" });
  assert.equal(ticketmasterPrimaryArtistIdentity(make([]), options), null);
  assert.equal(ticketmasterPrimaryArtistIdentity(make([{ id: "ID", name: "Other" }]), options), null);
  assert.equal(ticketmasterPrimaryArtistIdentity(make([{ id: "ID", name: "Performer", classifications: [{ segment: { name: "Sports" } }] }]), options), null);
  assert.equal(ticketmasterPrimaryArtistIdentity(make([{ id: "ID", name: "Performer", classifications: [{ segment: { name: 12 } }] }]), options), null);
  assert.equal(ticketmasterPrimaryArtistIdentity(make([{ id: "ID", name: "Performer" },
    { id: "ID", name: "Performer", classifications: [{ segment: { name: "Sports" } }] }]), options), null);
  assert.equal(ticketmasterPrimaryArtistIdentity(make([{ id: "ID", name: "Performer" }]), { ...options, musicEvidence: "ticketmaster:artist-search:matched-attraction" }), null);
  assert.equal(ticketmasterPrimaryArtistIdentity(make([{ id: "K8vZ917LxIV", name: "USHER RAYMOND & CHRIS BROWN" }]), { ...options, artist: "USHER RAYMOND & CHRIS BROWN" }), null);
  assert.deepEqual(ticketmasterPrimaryArtistIdentity(make([{ id: "ID1", name: "Performer" }, { id: "ID2", name: "Performer" }]), options), { status: "conflict" });
});
