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

function evidencedGenre(value, extra = {}) {
  return JSON.stringify({
    ...extra,
    genreClaims: [{ value, source: "provider", at: 1 }],
  });
}

function musicBrainzEvidencedGenre(value = "Hip Hop") {
  const artistMbid = "11111111-1111-4111-8111-111111111111";
  const genreId = "22222222-2222-4222-8222-222222222222";
  return JSON.stringify({
    mbid: artistMbid,
    genreClaims: [{ value, source: "musicbrainz_genre", at: 1 }],
    musicBrainzGenreEvidence: {
      genre: value,
      genreId,
      provider: "musicbrainz",
      basis: "artist-genres-v1",
      artistMbid,
      supportingCount: 4,
      counts: [{ genre: value, id: genreId, count: 4 }],
      checkedAt: 1,
    },
  });
}

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
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER
    );
    INSERT INTO users VALUES ('member-1', 0, NULL), ('member-2', 0, NULL), ('banned-member', 1, NULL);
    CREATE TABLE plays (artist TEXT, user_id TEXT, created_at INTEGER);
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,artist TEXT NOT NULL,artist_key TEXT,
      venue TEXT NOT NULL,venue_key TEXT,city TEXT,date TEXT,overall REAL,review TEXT,
      tour TEXT,kind TEXT,experience_type TEXT NOT NULL DEFAULT 'in_person',
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER,updated_at INTEGER
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,place TEXT,date TEXT,
      source TEXT,venue_provider_id TEXT,venue_city TEXT,venue_region TEXT,
      venue_country_code TEXT,venue_country TEXT,owner_id TEXT,updated_at INTEGER
    );
  `);
  const addArtist = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)");
  addArtist.run("alpha", "Alpha", "rap", "Canada", 90, 9, "alpha.jpg", evidencedGenre("rap", { followers: 120, topTracks: [{ title: "First", url: "first.mp3" }] }));
  addArtist.run("bravo", "Bravo", "Hip Hop", "United States", 98, 10, "bravo.jpg", evidencedGenre("Hip Hop"));
  addArtist.run("charlie", "Charlie", "indie rock", "Canada", 80, 8, null, evidencedGenre("indie rock"));
  addArtist.run("delta", "Delta", "Soul", "Canada", 70, 7, null, "{}");
  const addPlay = database.prepare("INSERT INTO plays VALUES (?,?,?)");
  addPlay.run("Alpha", "member-1", 1);
  addPlay.run("Alpha", "member-1", 2);
  addPlay.run("Bravo", "member-2", 3);
  addPlay.run("Charlie", "member-1", 4);
  addPlay.run("Charlie", "member-2", 5);
  addPlay.run("Charlie", "member-3", 6);
  return database;
}

function fixtureDiscoverService(database, options = {}) {
  const reviewedArtistNorms = new Set(database.prepare("SELECT norm FROM artists").all()
    .map((row) => row.norm));
  return createDiscoverService({ database, ...options, reviewedArtistNorms });
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
    addArtist.run("legacy-alternative", "Legacy Alternative", "Alternative", "Canada", 98, 10, null, "{}");
    addArtist.run("malformed-crawl", "Malformed Crawl", "Metal", "Canada", 97, 10, null, "{not-json");
    addArtist.run("provider-evidence", "Provider Evidence", "House", "Canada", 95, 10, null, JSON.stringify({
      genreClaims: [
        { value: "House", source: "tag_hint", at: 1 },
        { value: "contemporary r&b", source: "provider", at: 2 },
      ],
    }));
    addArtist.run("musicbrainz-evidence", "MusicBrainz Evidence", "Hip Hop", "Canada", 94, 10, null, musicBrainzEvidencedGenre());

    const service = fixtureDiscoverService(database);
    const chart = service.chart({ country: "Canada", limit: 10 });
    const byName = Object.fromEntries(chart.rows.map((row) => [row.name, row]));
    assert.equal(byName["Legacy Crawl"].genre, null, "a legacy crawl label must not be stated as fact");
    assert.equal(byName["Legacy Alternative"].genre, null, "an unlisted bare legacy label must also fail closed");
    assert.equal(byName["Malformed Crawl"].genre, null, "malformed rich data must fail closed around a crawl label");
    assert.equal(byName["Provider Evidence"].genre, "R&B", "provider evidence should display and canonicalize");
    assert.equal(byName["MusicBrainz Evidence"].genre, "Hip-Hop", "exact-MBID genre evidence should reach Discover rows");

    const genres = service.genres({ country: "Canada", limit: 12 });
    assert.equal(genres.genres.some((row) => row.genre === "Hardcore"), false);
    assert.equal(genres.genres.some((row) => row.genre === "Alternative"), false);
    assert.equal(genres.genres.some((row) => row.genre === "House"), false, "the stale raw column must not be counted");
    assert.equal(genres.genres.find((row) => row.genre === "R&B")?.count, 1);
    assert.equal(genres.genres.find((row) => row.genre === "Hip-Hop")?.count, 2);
    assert.equal(genres.total, 4, "only evidence-backed genres are included in the genre section");

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
    const service = fixtureDiscoverService(database, { clock: () => 1000 });
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
    const service = fixtureDiscoverService(database);
    const result = service.chart({ genre: "Hip-Hop", country: "canada", limit: 10 });
    assert.equal(result.source, "popularity");
    assert.deepEqual(result.rows.map((row) => row.name), ["Alpha"]);
    assert.deepEqual(result.rows[0].topTrack, { title: "First", url: "first.mp3" });
    assert.equal(result.rows[0].followers, 120);
  } finally {
    database.close();
  }
});

test("popularity chart skips unreviewed provider rows with inconsistent identity data", () => {
  const database = fixture();
  try {
    const addArtist = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)");
    addArtist.run("d", "D", "Hip Hop", "Canada", 100, 100, null,
      JSON.stringify({ name: "D", followers: 24_000_000, topTracks: [{ title: "Wrong Artist Track" }] }));
    addArtist.run("emonyx", "EMONYX", "Hip Hop", "Canada", 99, 99, null,
      JSON.stringify({ name: "EMONYX", followers: 19_000_000, topTracks: [{ title: "Lose Yourself" }] }));

    const service = createDiscoverService({
      database,
      reviewedArtistNorms: new Set(["alpha", "bravo", "charlie", "delta"]),
    });
    const result = service.chart({ country: "Canada", limit: 10 });
    assert.deepEqual(result.rows.map((row) => row.name), ["Alpha", "Charlie", "Delta"]);
  } finally {
    database.close();
  }
});

test("genre artists put confidence-ranked MSHpit live ratings before separate popularity rows", () => {
  const database = fixture();
  try {
    const addArtist = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)");
    addArtist.run("echo", "Echo", "Hip Hop", "Canada", 96, 9, null, evidencedGenre("Hip Hop"));
    addArtist.run("foxtrot", "Foxtrot", "Hip Hop", "Canada", 95, 8, null, evidencedGenre("Hip Hop"));
    const addPost = database.prepare(`INSERT INTO posts
      (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,review,tour,kind,experience_type,removed,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    // The newest rating from one member for one exact show wins; the older 1.0
    // cannot drag Alpha down or inflate its sample count.
    addPost.run("alpha-old", "member-1", "Alpha", "alpha", "Hall A", "hall-a", "Toronto, Canada", "2026-01-01", 1, "old", null, "review", "in_person", 0, 1, 1);
    addPost.run("alpha-new", "member-1", "Alpha", "alpha", "Hall A", "hall-a", "Toronto, Canada", "2026-01-01", 4.5, "Excellent live show", null, "review", "in_person", 0, 4, 4);
    addPost.run("alpha-two", "member-2", "Alpha", "alpha", "Hall B", "hall-b", "Toronto, Canada", "2026-02-01", 4.5, "", null, "review", "in_person", 0, 3, 3);
    addPost.run("echo-one", "member-1", "Echo", "echo", "Hall C", "hall-c", "Toronto, Canada", "2026-03-01", 5, "Perfect night", null, "review", "in_person", 0, 2, 2);
    addPost.run("echo-online", "member-2", "Echo", "echo", "YouTube", "youtube", "Online", "2026-03-02", 5, "Stream review", null, "review", "online", 0, 5, 5);

    const result = fixtureDiscoverService(database).chart({ genre: "Hip-Hop", country: "Canada", limit: 12 });
    assert.deepEqual(result.ratedRows.map((row) => row.name), ["Alpha", "Echo"], "sample confidence beats a lone perfect rating");
    assert.deepEqual(
      result.ratedRows.map((row) => ({ name: row.name, ratingCount: row.ratingCount, reviewCount: row.reviewCount, avgRating: row.avgRating })),
      [
        { name: "Alpha", ratingCount: 2, reviewCount: 1, avgRating: 4.5 },
        { name: "Echo", ratingCount: 1, reviewCount: 1, avgRating: 5 },
      ],
    );
    assert.deepEqual(result.popularRows.map((row) => row.name), ["Foxtrot"], "provider popularity remains a separate, deduplicated group");
    assert.deepEqual(result.rows.map((row) => row.rankingGroup), ["top-reviewed", "top-reviewed", "popular"]);
  } finally {
    database.close();
  }
});

test("plays chart honors genre and country instead of returning an unfiltered global list", () => {
  const database = fixture();
  try {
    const service = fixtureDiscoverService(database);
    const result = service.chart({ by: "plays", genre: "Indie", country: "Canada", limit: 10 });
    assert.deepEqual(result.rows.map((row) => ({ name: row.name, plays: row.plays })), [{ name: "Charlie", plays: 3 }]);
    assert.equal(result.rows[0].playsApproximate, true);
    assert.deepEqual(result.privacy, { minimumListeners: 3, delayedHours: 6, counts: "lower-bound" });
    assert.equal(result.live, false);
    assert.deepEqual(service.chart({ by: "plays", genre: "Hip-Hop", country: "Canada", limit: 10 }).rows, [],
      "one listener's repeated plays never become a public chart row");
  } finally {
    database.close();
  }
});

test("overview returns one coherent first-paint payload", () => {
  const database = fixture();
  try {
    const service = fixtureDiscoverService(database, { clock: () => 1_700_000_000_000 });
    const result = service.overview({ country: "Canada" });
    assert.deepEqual(result.chart.rows.map((row) => row.name), ["Alpha", "Charlie", "Delta"]);
    assert.equal(result.chart.rows.find((row) => row.name === "Delta")?.genre, null);
    assert.equal(result.genreTotal, 2);
    assert.equal(result.distinctGenres, 2);
    assert.equal(result.catalogTotal, 4);
    assert.equal(Object.hasOwn(result, "memberTotal"), false, "Discover no longer computes or returns a member count");
    assert.deepEqual(result.countries, []); // default minimum is five artists
    assert.equal(result.generatedAt, "2023-11-14T22:13:20.000Z");
  } finally {
    database.close();
  }
});
