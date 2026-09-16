import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fillMissingArtistPhotos, loadPhotoFillBatch, persistPhotoFill } from "./catalogSeed.js";
import { rememberDiscoverArtists } from "./discoverArtistPriority.js";

const AT = Date.parse("2026-09-16T12:00:00Z");
const ID = "1234567890ABCDEFGHIJKL";
const enrichment = { provider: "spotify", spotifyId: ID, spotifyPhoto: "https://i.scdn.co/image/photo123", photoSourceUrl: `https://open.spotify.com/artist/${ID}`, spotifyPhotoCheckedAt: AT };
function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,genre TEXT,photo TEXT,mbid TEXT,spotify_id TEXT,country TEXT,formed TEXT,popularity INTEGER,data TEXT,source TEXT,updated_at INTEGER,bio TEXT,rank_score REAL);
    CREATE TABLE artist_profiles(artist_key TEXT,removed INTEGER DEFAULT 0,avatar_uri TEXT);
    CREATE TABLE posts(artist_key TEXT,removed INTEGER);
    CREATE TABLE fan_club_members(artist TEXT);
    CREATE TABLE tour_dates(artist_key TEXT,provider_active INTEGER);
    CREATE TABLE artist_tourdate_refresh_queue(artist_key TEXT);`);
  const add = (key = "artist", regular = true) => {
    database.prepare("INSERT INTO artists(norm,name,genre,mbid,spotify_id,data,source,updated_at,bio,rank_score) VALUES (?,?,?, ?,?,?,?, ?,?,?)")
      .run(key, `Name ${key}`, "Rock", "verified-mbid", ID, JSON.stringify({ bio: "Original", marker: "old" }), "staff", AT - 1000, "Original", 77);
    if (regular) database.prepare("INSERT INTO posts VALUES (?,0)").run(key);
    return database.prepare("SELECT * FROM artists WHERE norm=?").get(key);
  };
  return { database, add, row: (key = "artist") => database.prepare("SELECT * FROM artists WHERE norm=?").get(key), close: () => database.close() };
}

test("photo completion merges into current metadata without rewriting staff facts or rankings", () => {
  const f = fixture();
  try {
    const requested = f.add();
    const currentData = { bio: "Staff correction", marker: "new", artistKnowledge: { version: 2, source: "verified" } };
    f.database.prepare("UPDATE artists SET genre='Folk',bio='Staff correction',country='Canada',rank_score=99,data=?,updated_at=? WHERE norm='artist'").run(JSON.stringify(currentData), AT);
    assert.equal(persistPhotoFill(requested, enrichment, { database: f.database, at: AT + 1 }), true);
    const saved = f.row(), data = JSON.parse(saved.data);
    assert.equal(saved.genre, "Folk"); assert.equal(saved.bio, "Staff correction");
    assert.equal(saved.country, "Canada"); assert.equal(saved.rank_score, 99); assert.equal(saved.source, "staff");
    assert.equal(data.marker, "new"); assert.deepEqual(data.artistKnowledge, currentData.artistKnowledge);
    assert.equal(data.spotifyPhoto, enrichment.spotifyPhoto); assert.equal(saved.photo, null);
  } finally { f.close(); }
});

test("late photo work never revives deleted artists or follows changed identity", () => {
  for (const mutation of ["DELETE FROM artists", "UPDATE artists SET name='Other Artist'", "UPDATE artists SET mbid='other-id'", "UPDATE artists SET spotify_id='ABCDEFGHIJKLMNOPQRSTUV'", `UPDATE artists SET data='{"spotifyId":"ABCDEFGHIJKLMNOPQRSTUV"}'`]) {
    const f = fixture();
    try {
      const requested = f.add(); f.database.exec(mutation);
      const before = f.row();
      assert.equal(persistPhotoFill(requested, enrichment, { database: f.database, at: AT }), null, mutation);
      assert.deepEqual(f.row(), before);
    } finally { f.close(); }
  }
});

test("concurrent owner photos, typed photos, fresh provider checks and corrupt metadata win over stale work", () => {
  for (const mutation of [
    "INSERT INTO artist_profiles VALUES ('artist',0,'https://uploads.example/owner.webp')",
    "INSERT INTO artist_profiles VALUES ('artist',1,NULL)",
    "UPDATE artists SET photo='https://uploads.example/staff.webp'",
    `UPDATE artists SET data='{"photo":"https://uploads.example/staff.webp"}'`,
    `UPDATE artists SET data='{"spotifyPhotoCheckedAt":${AT},"spotifyPhoto":"https://i.scdn.co/image/newer"}'`,
    "UPDATE artists SET data='{bad-json'",
  ]) {
    const f = fixture();
    try {
      const requested = f.add(); f.database.exec(mutation); const before = f.row();
      assert.equal(persistPhotoFill(requested, enrichment, { database: f.database, at: AT }), null, mutation);
      assert.deepEqual(f.row(), before);
    } finally { f.close(); }
  }
});

test("photo compare-and-swap catches another writer even after the fresh read", () => {
  const f = fixture();
  try {
    const requested = f.add();
    const wrapped = { prepare(sql) {
      if (sql.startsWith("UPDATE artists SET photo=")) f.database.exec("UPDATE artists SET mbid='changed-between-read-and-write'");
      return f.database.prepare(sql);
    } };
    assert.equal(persistPhotoFill(requested, enrichment, { database: wrapped, at: AT }), null);
    assert.equal(f.row().mbid, "changed-between-read-and-write");
    assert.equal(JSON.parse(f.row().data).spotifyPhoto, undefined);
  } finally { f.close(); }
});

test("provider identity mismatch cannot attach an image to another artist", () => {
  const f = fixture();
  try {
    const requested = f.add();
    assert.equal(persistPhotoFill(requested, { ...enrichment, spotifyId: "ABCDEFGHIJKLMNOPQRSTUV" }, { database: f.database, at: AT }), null);
    assert.equal(JSON.parse(f.row().data).spotifyPhoto, undefined);
  } finally { f.close(); }
});

test("Discover photo priority is bounded and interleaves ordinary catalogue progress without jumping its cursor", async () => {
  const f = fixture();
  try {
    for (const key of ["p-a", "p-b", "p-c", "p-d"]) f.add(key, false);
    for (const key of ["r-a", "r-b", "r-c"]) f.add(key);
    rememberDiscoverArtists(f.database, ["p-a", "p-b", "p-c", "p-d"].map((key) => ({ key })), AT);
    const batch = loadPhotoFillBatch("", 4, { database: f.database, at: AT });
    assert.deepEqual(batch.rows.map((row) => row.norm), ["p-a", "p-b", "p-c", "r-a"]);
    const writes = [];
    const stats = await fillMissingArtistPhotos({
      limit: 4, readCursor: () => "", writeCursor: (value) => writes.push(value), loadBatch: () => batch,
      enrichArtist: async () => enrichment, persistArtist: () => true, pause: async () => {},
    });
    assert.deepEqual(writes, ["r-a"]); assert.equal(stats.priorityAttempted, 3); assert.equal(stats.attempted, 4);
    assert.equal(loadPhotoFillBatch("r-a", 4, { database: f.database, at: AT }).rows[3].norm, "r-b");
    f.database.exec("INSERT INTO artist_profiles VALUES ('p-a',0,'https://uploads.example/avatar.webp')");
    assert.equal(loadPhotoFillBatch("", 4, { database: f.database, at: AT }).rows.some((row) => row.norm === "p-a"), false);
  } finally { f.close(); }
});

test("pause during provider await prevents persistence and cursor advancement", async () => {
  let stopped = false, writes = 0, saves = 0;
  const result = await fillMissingArtistPhotos({
    shouldStop: () => stopped, readCursor: () => "prior", writeCursor: () => { writes += 1; },
    loadBatch: () => ({ rows: [{ norm: "artist", name: "Artist" }] }),
    enrichArtist: async () => { stopped = true; return enrichment; },
    persistArtist: () => { saves += 1; return true; }, pause: async () => {},
  });
  assert.equal(writes, 0); assert.equal(saves, 0); assert.equal(result.stopped, true); assert.equal(result.cursor, "prior");
});
