import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-musicbrainz-genres-"));
process.env.PIT_DATA_DIR = dataDir;

const {
  createMusicBrainzGenreRefreshService,
  fetchExactMusicBrainzArtistGenres,
  isMusicBrainzGenreRefreshEnabled,
  MUSICBRAINZ_GENRE_REFRESH_DEFAULT_BATCH,
  MUSICBRAINZ_GENRE_REFRESH_INTERVAL_MS,
  musicBrainzArtistGenreEvidence,
} = await import("./musicBrainzGenreRefresh.js");
const { db } = await import("./db.js");
const { projectArtistGenre } = await import("../src/domain/genre.mjs");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const ALPHA_MBID = "11111111-1111-4111-8111-111111111111";
const BETA_MBID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HIP_HOP_MBID = "22222222-2222-4222-8222-222222222222";
const POP_MBID = "33333333-3333-4333-8333-333333333333";
const GAMMA_MBID = "44444444-4444-4444-8444-444444444444";
const DELTA_MBID = "55555555-5555-4555-8555-555555555555";

function payload(artistMbid, genres = [
  { id: HIP_HOP_MBID, name: "Hip Hop", count: 5 },
  { id: POP_MBID, name: "Pop", count: 2 },
]) {
  return { id: artistMbid, genres };
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE artists (
      norm TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mbid TEXT,
      genre TEXT,
      data TEXT,
      updated_at INTEGER NOT NULL,
      rank_score INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return database;
}

test("MusicBrainz genre parsing requires the exact artist and a unique supported winner", () => {
  const verified = musicBrainzArtistGenreEvidence(payload(ALPHA_MBID), ALPHA_MBID, 1_000);
  assert.equal(verified.status, "verified");
  assert.deepEqual(verified.evidence.counts, [
    { genre: "Hip Hop", id: HIP_HOP_MBID, count: 5 },
    { genre: "Pop", id: POP_MBID, count: 2 },
  ]);

  assert.equal(musicBrainzArtistGenreEvidence(payload(BETA_MBID), ALPHA_MBID).status, "identity_mismatch");
  assert.equal(musicBrainzArtistGenreEvidence(payload(ALPHA_MBID, [
    { id: HIP_HOP_MBID, name: "Hip Hop", count: 3 },
    { id: POP_MBID, name: "Pop", count: 3 },
  ]), ALPHA_MBID).status, "tie");
  assert.equal(musicBrainzArtistGenreEvidence(payload(ALPHA_MBID, [
    { id: HIP_HOP_MBID, name: "Hip Hop", count: 1 },
  ]), ALPHA_MBID).status, "weak");
  assert.equal(musicBrainzArtistGenreEvidence(payload(ALPHA_MBID, []), ALPHA_MBID).status, "empty");
});

test("the exact lookup never name-searches and sends the required identifying User-Agent", async () => {
  let request = null;
  const result = await fetchExactMusicBrainzArtistGenres(ALPHA_MBID, {
    requestGate: async (request) => request(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => payload(ALPHA_MBID) };
    },
  });
  assert.equal(result.id, ALPHA_MBID);
  assert.equal(
    request.url,
    `https://musicbrainz.org/ws/2/artist/${ALPHA_MBID}?inc=genres&fmt=json`,
  );
  assert.equal(request.options.headers["User-Agent"], "Mshpit/1.0 (https://mshpit.com)");
});

test("the bounded worker persists verified evidence, cursor, and per-artist checks", async () => {
  const database = fixture();
  try {
    const insert = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?)");
    insert.run("alpha", "Alpha", ALPHA_MBID, "Hardcore", JSON.stringify({ spotifyId: "not-genre-evidence" }), 10, 20);
    insert.run("beta", "Beta", BETA_MBID, null, "{}", 10, 10);

    const fetched = [];
    const service = createMusicBrainzGenreRefreshService({
      database,
      clock: () => 50_000,
      fetchArtist: async (mbid) => {
        fetched.push(mbid);
        return payload(mbid);
      },
    });
    const first = await service.runBatch({ limit: 2, scanLimit: 2 });
    assert.deepEqual(first, { scanned: 2, attempted: 2, verified: 2, deferred: 0, failed: 0, stale: 0 });
    assert.deepEqual(fetched, [ALPHA_MBID, BETA_MBID]);
    assert.deepEqual(JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?")
      .get("artist:genre:musicbrainz:cursor:v1")?.value), { rank: 10, norm: "beta" });

    const alpha = database.prepare("SELECT genre,data FROM artists WHERE norm='alpha'").get();
    const alphaData = JSON.parse(alpha.data);
    assert.equal(alpha.genre, "Hip Hop", "verified evidence replaces the hidden crawler column");
    assert.equal(alphaData.musicBrainzGenreRefresh.checkedAt, 50_000);
    assert.equal(alphaData.musicBrainzGenreEvidence.artistMbid, ALPHA_MBID);
    assert.equal(projectArtistGenre(alphaData, alpha.genre).genre, "Hip Hop");

    const afterDeploy = createMusicBrainzGenreRefreshService({
      database,
      clock: () => 50_001,
      fetchArtist: async () => { throw new Error("a persisted check must not be repeated after deploy"); },
      wait: async () => {},
    });
    const second = await afterDeploy.runBatch({ limit: 2, scanLimit: 2 });
    assert.equal(second.attempted, 0);
    assert.equal(second.scanned, 2);
  } finally {
    database.close();
  }
});

test("the durable cursor never skips due rows beyond a bounded batch", async () => {
  const database = fixture();
  try {
    const insert = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?)");
    insert.run("alpha", "Alpha", ALPHA_MBID, null, "{}", 10, 50);
    insert.run("beta", "Beta", BETA_MBID, null, "{}", 10, 40);
    insert.run("gamma", "Gamma", GAMMA_MBID, null, "{}", 10, 30);
    insert.run("delta", "Delta", DELTA_MBID, null, "{}", 10, 20);
    const fetched = [];
    const service = createMusicBrainzGenreRefreshService({
      database,
      clock: () => 70_000,
      fetchArtist: async (mbid) => {
        fetched.push(mbid);
        return payload(mbid);
      },
    });

    await service.runBatch({ limit: 2, scanLimit: 4 });
    assert.deepEqual(fetched, [ALPHA_MBID, BETA_MBID]);
    assert.deepEqual(JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?")
      .get("artist:genre:musicbrainz:cursor:v1")?.value), { rank: 40, norm: "beta" });

    await service.runBatch({ limit: 2, scanLimit: 4 });
    assert.deepEqual(fetched, [ALPHA_MBID, BETA_MBID, GAMMA_MBID, DELTA_MBID],
      "the next slice must continue with the rows that did not fit in the first slice");
  } finally {
    database.close();
  }
});

test("Render genre enrichment is opt-in and malformed values fail closed", () => {
  assert.equal(MUSICBRAINZ_GENRE_REFRESH_DEFAULT_BATCH, 30,
    "each scheduled slice stays bounded to 30 exact identities");
  assert.equal(MUSICBRAINZ_GENRE_REFRESH_INTERVAL_MS, 5 * 60 * 1000,
    "five-minute slices complete the current 1,633-artist first pass in about 4.6 hours");
  assert.equal(isMusicBrainzGenreRefreshEnabled({ RENDER: "true" }), false);
  assert.equal(isMusicBrainzGenreRefreshEnabled({ RENDER: "true", ARTIST_GENRE_REFRESH_ENABLED: "true" }), true);
  assert.equal(isMusicBrainzGenreRefreshEnabled({ RENDER: "true", ARTIST_GENRE_REFRESH_ENABLED: "tru" }), false);
});

test("one provider-wide failure stops the current slice instead of repeating doomed work", async () => {
  const database = fixture();
  try {
    const insert = database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?)");
    insert.run("alpha", "Alpha", ALPHA_MBID, null, "{}", 10, 20);
    insert.run("beta", "Beta", BETA_MBID, null, "{}", 10, 10);
    let calls = 0;
    const service = createMusicBrainzGenreRefreshService({
      database,
      clock: () => 60_000,
      fetchArtist: async () => {
        calls += 1;
        const error = new Error("rate limited");
        error.status = 429;
        throw error;
      },
    });
    const result = await service.runBatch({ limit: 2, scanLimit: 2 });
    assert.equal(calls, 1);
    assert.equal(result.attempted, 1);
    assert.equal(result.failed, 1);
    assert.equal(JSON.parse(database.prepare("SELECT data FROM artists WHERE norm='alpha'").get().data)
      .musicBrainzGenreRefresh.status, "provider_error");
    assert.equal(JSON.parse(database.prepare("SELECT data FROM artists WHERE norm='beta'").get().data)
      .musicBrainzGenreRefresh, undefined);
  } finally {
    database.close();
  }
});
