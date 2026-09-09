import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { REVIEWED_ARTIST_IDENTITIES, resolveReviewedArtistAlias, seedReviewedArtistIdentities } from "./reviewedArtistIdentities.js";

const reviewed = REVIEWED_ARTIST_IDENTITIES[0];
const otherMbid = "00000000-0000-4000-8000-000000000002";

function makeArtistRow(norm, data, source) {
  return { norm, name: data.name, mbid: data.mbid, public_slug: norm.replaceAll(" ", "-"),
    search_key: data.name.toLowerCase().replace(/[^a-z0-9]/gu, ""),
    genre: null, photo: null, bio: null, spotify_id: null, country: null, formed: null,
    popularity: null, rank_score: 0, data: JSON.stringify(data), source, created_at: 100, updated_at: 100 };
}

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE artists (
    norm TEXT PRIMARY KEY,name TEXT NOT NULL,public_slug TEXT,search_key TEXT,
    genre TEXT,photo TEXT,bio TEXT,mbid TEXT,spotify_id TEXT,country TEXT,formed TEXT,
    popularity INTEGER,rank_score INTEGER NOT NULL DEFAULT 0,data TEXT,source TEXT,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX idx_artists_mbid_lower ON artists(lower(mbid));
    CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY,owner_id TEXT,bio TEXT,updated_at INTEGER);`);
  const seed = (options = {}) => seedReviewedArtistIdentities(database, { makeArtistRow, ...options });
  const add = (norm, mbid, fields = {}) => {
    const row = { ...makeArtistRow(norm, { name: norm, mbid }, "existing"), ...fields };
    const keys = Object.keys(row);
    database.prepare(`INSERT INTO artists (${keys.join(",")}) VALUES (${keys.map((key) => `@${key}`).join(",")})`).run(row);
  };
  const rows = () => database.prepare("SELECT * FROM artists ORDER BY norm").all();
  return { database, seed, add, rows };
}

test("reviewed identity adds only sourced facts and repeats without mutation", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.seed(), { inserted: 1, existing: 0, conflicts: 0 });
  const snapshot = f.rows();
  assert.equal(snapshot[0].norm, "a$ap rocky");
  assert.equal(snapshot[0].name, "A$AP Rocky");
  assert.equal(snapshot[0].mbid, "25b7b584-d952-4662-a8b9-dd8cdfbfeb64");
  assert.deepEqual(JSON.parse(snapshot[0].data), reviewed);
  for (const field of ["photo", "genre", "bio", "popularity", "country"]) assert.equal(snapshot[0][field], null);
  assert.equal(snapshot[0].source, "reviewed-identity");
  assert.deepEqual(f.seed(), { inserted: 0, existing: 1, conflicts: 0 });
  assert.deepEqual(f.rows(), snapshot);
});

test("reviewed seed never overwrites rich artist metadata or owner profile", (t) => {
  const f = fixture(t);
  f.add("a$ap rocky", reviewed.mbid.toUpperCase(), { name: reviewed.name,
    data: '{"staff":"retained"}', photo: "https://images.example/retained.jpg", bio: "Existing biography",
    public_slug: "immutable-artist-page", rank_score: 98765, updated_at: 55 });
  f.database.prepare("INSERT INTO artist_profiles VALUES (?,?,?,?)").run("a$ap rocky", "owner", "Owner bio", 33);
  const snapshot = f.rows();
  const profile = f.database.prepare("SELECT * FROM artist_profiles").get();
  assert.deepEqual(f.seed({ makeArtistRow: () => { throw new Error("Existing artist must not be rebuilt"); } }),
    { inserted: 0, existing: 1, conflicts: 0 });
  assert.deepEqual(f.rows(), snapshot);
  assert.deepEqual(f.database.prepare("SELECT * FROM artist_profiles").get(), profile);
});

test("a conflicting or unproven canonical identity is skipped without guessing", (t) => {
  for (const mbid of [otherMbid, null]) {
    const f = fixture(t);
    f.add("a$ap rocky", mbid);
    const snapshot = f.rows();
    assert.deepEqual(f.seed(), { inserted: 0, existing: 0, conflicts: 1 });
    assert.deepEqual(f.rows(), snapshot);
    assert.equal(resolveReviewedArtistAlias(f.database, "ASAP Rocky"), null);
  }
});

test("the same MBID under a different key is preserved rather than duplicated", (t) => {
  const f = fixture(t);
  f.add("existing-key", reviewed.mbid, { name: reviewed.name, public_slug: "existing-url" });
  const snapshot = f.rows();
  assert.deepEqual(f.seed(), { inserted: 0, existing: 1, conflicts: 0 });
  assert.deepEqual(f.rows(), snapshot);
  for (const name of ["A$AP Rocky", "ASAP Rocky"]) {
    assert.equal(resolveReviewedArtistAlias(f.database, name)?.norm, "existing-key");
  }
});

test("duplicate persisted MBIDs fail closed in the seed and alias reader", (t) => {
  const f = fixture(t);
  f.add("a$ap rocky", reviewed.mbid);
  f.add("duplicate-key", reviewed.mbid.toUpperCase());
  const snapshot = f.rows();
  assert.deepEqual(f.seed(), { inserted: 0, existing: 0, conflicts: 1 });
  assert.deepEqual(f.rows(), snapshot);
  assert.equal(resolveReviewedArtistAlias(f.database, "ASAP Rocky"), null);
});

test("alias lookup is read-only, exact, and refreshes current persisted evidence", (t) => {
  const f = fixture(t);
  assert.equal(resolveReviewedArtistAlias(f.database, "ASAP Rocky"), null);
  f.seed();
  f.database.exec("PRAGMA query_only=ON");
  assert.equal(resolveReviewedArtistAlias(f.database, "  aSaP rOcKy  ")?.mbid, reviewed.mbid);
  for (const name of ["ASAP", "Rocky", "AAP Rocky", "ASAP  Rocky", "Lord Flacko", "ASAP Rocky?x=1", "%ASAP Rocky%", null, {}]) {
    assert.equal(resolveReviewedArtistAlias(f.database, name), null);
  }
  f.database.exec("PRAGMA query_only=OFF");
  f.database.prepare("UPDATE artists SET mbid=?").run(otherMbid);
  assert.equal(resolveReviewedArtistAlias(f.database, "ASAP Rocky"), null);
});

test("overlapping reviewed aliases with different identities are not guessed", (t) => {
  const f = fixture(t);
  f.seed();
  const records = [reviewed, { name: "Other artist", mbid: otherMbid, aliases: ["ASAP Rocky"] }];
  assert.equal(resolveReviewedArtistAlias(f.database, "ASAP Rocky", { records }), null);
});

test("a failing later insertion rolls back the entire reviewed seed", (t) => {
  const f = fixture(t);
  f.add("untouched", "00000000-0000-4000-8000-000000000003");
  const snapshot = f.rows();
  f.database.exec(`CREATE TRIGGER reject_fixture_identity BEFORE INSERT ON artists
    WHEN NEW.norm='second fixture' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;`);
  const records = [reviewed, { name: "Second Fixture", mbid: otherMbid, aliases: [], sourceUrl: "https://example.test/evidence" }];
  assert.throws(() => f.seed({ records }), /fixture write failure/u);
  assert.equal(f.database.isTransaction, false);
  assert.deepEqual(f.rows(), snapshot);
  assert.equal(resolveReviewedArtistAlias(f.database, "ASAP Rocky"), null);
});

test("reviewed seed does not commit or roll back an unrelated caller transaction", (t) => {
  const f = fixture(t);
  f.database.exec("BEGIN IMMEDIATE");
  f.add("pending", otherMbid);
  assert.throws(() => f.seed(), /requires its own transaction/u);
  assert.equal(f.database.isTransaction, true);
  assert.equal(f.rows().length, 1);
  f.database.exec("ROLLBACK");
  assert.equal(f.rows().length, 0);
});
