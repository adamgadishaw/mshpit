import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// discoverService's production singleton imports db.js. Give that harmless
// default handle its own directory so this fixture never contends with parallel
// server tests over the runner's shared fallback database.
const dataDir = mkdtempSync(join(tmpdir(), "pit-discover-service-"));
process.env.PIT_DATA_DIR = dataDir;
const { canonicalGenre, createDiscoverService } = await import("./discoverService.js");
const { db } = await import("./db.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE artists (
      norm TEXT PRIMARY KEY, name TEXT NOT NULL, genre TEXT, country TEXT,
      popularity INTEGER, rank_score REAL, photo TEXT, data TEXT
    );
    CREATE TABLE artist_projection_revision (singleton INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
    INSERT INTO artist_projection_revision VALUES (1, 0);
    CREATE TRIGGER trg_artist_projection_insert AFTER INSERT ON artists BEGIN
      UPDATE artist_projection_revision SET revision = revision + 1 WHERE singleton = 1;
    END;
    CREATE TRIGGER trg_artist_projection_update AFTER UPDATE OF genre, data, country ON artists
    WHEN NOT (NEW.genre IS OLD.genre AND NEW.data IS OLD.data AND NEW.country IS OLD.country) BEGIN
      UPDATE artist_projection_revision SET revision = revision + 1 WHERE singleton = 1;
    END;
    CREATE TRIGGER trg_artist_projection_delete AFTER DELETE ON artists BEGIN
      UPDATE artist_projection_revision SET revision = revision + 1 WHERE singleton = 1;
    END;
    CREATE TABLE users (id TEXT PRIMARY KEY, is_banned INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users VALUES ('member-1', 0), ('member-2', 0), ('banned-member', 1);
    CREATE TABLE plays (artist TEXT, created_at INTEGER);
  `);
  const addArtist = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)");
  addArtist.run("alpha", "Alpha", "rap", "Canada", 90, 9, "alpha.jpg", JSON.stringify({ followers: 120, topTracks: [{ title: "First", url: "first.mp3" }] }));
  addArtist.run("bravo", "Bravo", "Hip Hop", "United States", 98, 10, "bravo.jpg", "{}");
  addArtist.run("charlie", "Charlie", "indie rock", "Canada", 80, 8, null, "{}");
  addArtist.run("delta", "Delta", "Soul", "Canada", 70, 7, null, "{}");
  const addPlay = database.prepare("INSERT INTO plays VALUES (?,?)");
  addPlay.run("Alpha", 1);
  addPlay.run("Alpha", 2);
  addPlay.run("Bravo", 3);
  addPlay.run("Charlie", 4);
  addPlay.run("Charlie", 5);
  addPlay.run("Charlie", 6);
  return database;
}

test("canonicalGenre collapses conservative aliases", () => {
  assert.equal(canonicalGenre(" hip hop "), "Hip-Hop");
  assert.equal(canonicalGenre("indie rock"), "Indie");
  assert.equal(canonicalGenre("Death Metal"), "Death Metal");
  assert.equal(canonicalGenre(""), null);
});

test("Discover hides crawl hints and only filters or aggregates evidenced genres", () => {
  const database = fixture();
  try {
    const addArtist = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)");
    addArtist.run("legacy-crawl", "Legacy Crawl", "Hardcore", "Canada", 99, 11, null, "{}");
    addArtist.run("malformed-crawl", "Malformed Crawl", "Metal", "Canada", 97, 10, null, "{not-json");
    addArtist.run("provider-evidence", "Provider Evidence", "House", "Canada", 95, 10, null, JSON.stringify({
      genreClaims: [
        { value: "House", source: "tag_hint", at: 1 },
        { value: "contemporary r&b", source: "provider", at: 2 },
      ],
    }));

    const service = createDiscoverService({ database });
    const chart = service.chart({ country: "Canada", limit: 10 });
    const byName = Object.fromEntries(chart.rows.map((row) => [row.name, row]));
    assert.equal(byName["Legacy Crawl"].genre, null, "a legacy crawl label must not be stated as fact");
    assert.equal(byName["Malformed Crawl"].genre, null, "malformed rich data must fail closed around a crawl label");
    assert.equal(byName["Provider Evidence"].genre, "R&B", "provider evidence should display and canonicalize");

    const genres = service.genres({ country: "Canada", limit: 12 });
    assert.equal(genres.genres.some((row) => row.genre === "Hardcore"), false);
    assert.equal(genres.genres.some((row) => row.genre === "House"), false, "the stale raw column must not be counted");
    assert.equal(genres.genres.find((row) => row.genre === "R&B")?.count, 1);
    assert.equal(genres.total, 3, "only the two existing provider genres and new provider claim are factual");

    assert.deepEqual(service.chart({ genre: "Hardcore", country: "Canada", limit: 10 }).rows, []);
    assert.deepEqual(
      service.chart({ genre: "R&B", country: "Canada", limit: 10 }).rows.map((row) => row.name),
      ["Provider Evidence"],
    );
  } finally {
    database.close();
  }
});

test("the projection cache is reused briefly and invalidates immediately on genre data changes", () => {
  const raw = fixture();
  let scans = 0;
  const database = {
    prepare(sql) {
      if (sql === "SELECT norm, country, genre, data FROM artists") scans += 1;
      return raw.prepare(sql);
    },
  };
  try {
    const service = createDiscoverService({ database, clock: () => 1000 });
    service.genres({ country: "Canada" });
    service.chart({ genre: "Hip-Hop", country: "Canada", limit: 10 });
    assert.equal(scans, 1, "one evidence projection serves both aggregation and filtering");

    raw.prepare("UPDATE artists SET genre=?, data=? WHERE norm=?").run("House", JSON.stringify({
      genreClaims: [{ value: "r&b", source: "provider", at: 2 }],
    }), "alpha");
    const genres = service.genres({ country: "Canada", limit: 12 });
    assert.equal(scans, 2, "the trigger revision invalidates the cache before its TTL");
    assert.equal(genres.genres.some((row) => row.genre === "Hip-Hop"), false);
    assert.equal(genres.genres.find((row) => row.genre === "R&B")?.count, 1);
    assert.deepEqual(service.chart({ genre: "Hip-Hop", country: "Canada", limit: 10 }).rows, []);

    raw.prepare("UPDATE artists SET country=? WHERE norm=?").run("United States", "alpha");
    const canada = service.genres({ country: "Canada", limit: 12 });
    assert.equal(scans, 3, "country membership changes also invalidate the projection");
    assert.equal(canada.genres.some((row) => row.genre === "R&B"), false);
    assert.deepEqual(
      service.chart({ genre: "R&B", country: "United States", limit: 10 }).rows.map((row) => row.name),
      ["Alpha"],
    );
  } finally {
    raw.close();
  }
});

test("popularity chart filters by canonical genre and country", () => {
  const database = fixture();
  try {
    const service = createDiscoverService({ database });
    const result = service.chart({ genre: "Hip-Hop", country: "canada", limit: 10 });
    assert.equal(result.source, "popularity");
    assert.deepEqual(result.rows.map((row) => row.name), ["Alpha"]);
    assert.deepEqual(result.rows[0].topTrack, { title: "First", url: "first.mp3" });
    assert.equal(result.rows[0].followers, 120);
  } finally {
    database.close();
  }
});

test("plays chart honors genre and country instead of returning an unfiltered global list", () => {
  const database = fixture();
  try {
    const service = createDiscoverService({ database });
    const result = service.chart({ by: "plays", genre: "Indie", country: "Canada", limit: 10 });
    assert.deepEqual(result.rows.map((row) => ({ name: row.name, plays: row.plays })), [{ name: "Charlie", plays: 3 }]);
  } finally {
    database.close();
  }
});

test("overview returns one coherent first-paint payload", () => {
  const database = fixture();
  try {
    const service = createDiscoverService({ database, clock: () => 1_700_000_000_000 });
    const result = service.overview({ country: "Canada" });
    assert.deepEqual(result.chart.rows.map((row) => row.name), ["Alpha", "Charlie", "Delta"]);
    assert.equal(result.chart.rows.find((row) => row.name === "Delta")?.genre, null);
    assert.equal(result.genreTotal, 2);
    assert.equal(result.distinctGenres, 2);
    assert.equal(result.catalogTotal, 4);
    assert.equal(result.memberTotal, 2, "public member totals exclude banned accounts like /api/people");
    assert.deepEqual(result.countries, []); // default minimum is five artists
    assert.equal(result.generatedAt, "2023-11-14T22:13:20.000Z");
  } finally {
    database.close();
  }
});
