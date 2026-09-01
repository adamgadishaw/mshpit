import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogSeedRequestOptions, crawlerGenreFields, fillMissingArtistPhotos, growOutcome, refreshSongsAndGenres,
  deezerEnrich, mergeGenreBackfillData, mergePhotoFillData, rotateRowsAfterCursor, shouldEnrichAfterCrawl,
} from "./catalogSeed.js";
import { displayGenre, resolveGenre, storedClaims } from "../src/domain/genre.mjs";
import { artistRow, artistStmts } from "./db.js";
import { ProviderError } from "./musicProviders.js";

// Regression cover for the 2026-07-14 incident. "Grow by 10k" added zero artists
// (every genre cursor had reached the end of its results) yet reported success and
// still ran a full Deezer re-enrichment over 5,599 existing profiles. That pass
// rewrote ~46k short-lived preview URLs, which then expired and broke playback.

test("a grow that adds nothing reports exhausted, never done", () => {
  const outcome = growOutcome({ added: 0, reachedTarget: false, stopRequested: false });
  assert.equal(outcome.phase, "exhausted");
  assert.equal(outcome.errorCode, "CATALOG_CRAWL_EXHAUSTED");
  assert.match(outcome.note, /left untouched/i);
});

test("a grow that adds artists reports done without an error code", () => {
  const outcome = growOutcome({ added: 120, reachedTarget: false, stopRequested: false });
  assert.equal(outcome.phase, "done");
  assert.equal(outcome.errorCode, undefined);
});

test("reaching the requested target is done even though the crawl stopped early", () => {
  const outcome = growOutcome({ added: 2000, reachedTarget: true, stopRequested: false });
  assert.equal(outcome.phase, "done");
});

test("a target already satisfied is not misreported as exhausted", () => {
  // reachedTarget short-circuits the crawl before it can add anything.
  const outcome = growOutcome({ added: 0, reachedTarget: true, stopRequested: false });
  assert.equal(outcome.phase, "done");
  assert.equal(outcome.errorCode, undefined);
});

test("an operator stop outranks both outcomes and keeps what was added", () => {
  assert.equal(growOutcome({ added: 0, reachedTarget: false, stopRequested: true }).phase, "stopped");
  assert.equal(growOutcome({ added: 50, reachedTarget: false, stopRequested: true }).phase, "stopped");
});

test("enrichment never runs when the crawl added nothing", () => {
  // The exact fall-through that rewrote ~46k expiring preview URLs.
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 0, stopRequested: false }), false);
});

test("enrichment runs only for artists this crawl actually added", () => {
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 12, stopRequested: false }), true);
  assert.equal(shouldEnrichAfterCrawl({ enrich: false, added: 12, stopRequested: false }), false);
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 12, stopRequested: true }), false);
});

test("catalog seed requests keep missing-photo repair distinct from grow and refresh", () => {
  assert.deepEqual(catalogSeedRequestOptions({ mode: "photos" }), { mode: "photos" });
  assert.deepEqual(catalogSeedRequestOptions({ mode: "refresh" }), { mode: "refresh" });
  assert.deepEqual(catalogSeedRequestOptions({ add: 5000 }), { add: 5000 });
  assert.deepEqual(catalogSeedRequestOptions({ mode: "unknown", add: 10 }), { add: 100 });
});

test("missing-photo repair resumes from its durable cursor and records each completed artist", async () => {
  const cursorWrites = [];
  const persisted = [];
  const result = await fillMissingArtistPhotos({
    readCursor: () => "artist-a",
    writeCursor: (value) => cursorWrites.push(value),
    loadBatch: (cursor, limit) => {
      assert.equal(cursor, "artist-a");
      assert.equal(limit, 40);
      return {
        rows: [{ norm: "artist-b", name: "Artist B" }, { norm: "artist-c", name: "Artist C" }],
        total: 12,
        wrapped: false,
      };
    },
    enrichArtist: async (name) => name === "Artist B" ? { deezerId: 2, photo: "https://example.com/b.jpg" } : null,
    persistArtist: (row) => { persisted.push(row.norm); return true; },
    pause: async () => {},
  });
  assert.deepEqual(cursorWrites, ["artist-b", "artist-c"]);
  assert.deepEqual(persisted, ["artist-b"]);
  assert.equal(result.attempted, 2);
  assert.equal(result.filled, 1);
  assert.equal(result.noMatch, 1);
  assert.equal(result.pendingAtStart, 12);
  assert.equal(result.cursor, "artist-c");
});

test("missing-photo repair preserves partial success and does not advance past a provider failure", async () => {
  const cursorWrites = [];
  const result = await fillMissingArtistPhotos({
    readCursor: () => "",
    writeCursor: (value) => cursorWrites.push(value),
    loadBatch: () => ({
      rows: [{ norm: "artist-a", name: "Artist A" }, { norm: "artist-b", name: "Artist B" }, { norm: "artist-c", name: "Artist C" }],
      total: 3,
      wrapped: false,
    }),
    enrichArtist: async (name) => {
      if (name === "Artist B") throw new ProviderError("Deezer", 429, "rate limited", { code: "rate_limited" });
      return { deezerId: 1, photo: "https://example.com/a.jpg" };
    },
    persistArtist: () => true,
    pause: async () => {},
  });
  assert.deepEqual(cursorWrites, ["artist-a"]);
  assert.equal(result.attempted, 1);
  assert.equal(result.filled, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.providerFailure.code, "CATALOG_PHOTOS_RATE_LIMITED");
  assert.equal(result.cursor, "artist-a", "the failed artist remains next after restart");
});

test("missing-photo repair stays bounded and stops only at an artist boundary", async () => {
  let stop = false;
  const cursorWrites = [];
  const result = await fillMissingArtistPhotos({
    shouldStop: () => stop,
    writeCursor: (value) => cursorWrites.push(value),
    loadBatch: (_cursor, limit) => ({
      rows: Array.from({ length: limit + 20 }, (_, index) => ({ norm: `artist-${index}`, name: `Artist ${index}` })),
      total: 1000,
      wrapped: false,
    }),
    enrichArtist: async () => ({ deezerId: 1, photo: "https://example.com/photo.jpg" }),
    persistArtist: () => { stop = true; return true; },
    pause: async () => {},
  });
  assert.equal(result.batchSize, 40, "one run cannot exceed the fixed provider-work budget");
  assert.equal(result.attempted, 1);
  assert.equal(result.stopped, true);
  assert.deepEqual(cursorWrites, ["artist-0"]);
});

test("photo enrichment preserves existing provider data while filling the missing image", () => {
  const merged = mergePhotoFillData(
    { name: "Photo Fixture", genre: "Rock", mbid: "mbid-1", country: "Canada", formed: "2001", popularity: 55, photo: null },
    { bio: "Keep this biography", topTracks: [{ title: "Keep This" }] },
    { deezerId: 42, photo: "https://example.com/photo.jpg", popularity: 70, followers: 1000, topTracks: [{ title: "Replacement" }] },
  );
  assert.equal(merged.photo, "https://example.com/photo.jpg");
  assert.equal(merged.photoCredit, "Deezer");
  assert.equal(merged.popularity, 55);
  assert.equal(merged.bio, "Keep this biography");
  assert.deepEqual(merged.topTracks, [{ title: "Keep This" }]);
  assert.equal(merged.mbid, "mbid-1");
});

test("crawler buckets persist as review hints, never as factual genres", () => {
  const fields = crawlerGenreFields("Hardcore");
  assert.equal(fields.genre, null);
  assert.equal(fields.genreHint, "Hardcore");
  const claims = storedClaims(fields, fields.genre);
  assert.equal(claims[0]?.source, "tag_hint");
  assert.equal(displayGenre(resolveGenre(claims)), null);
});

test("refresh processes genre-missing artists even when their songs are already complete", async () => {
  const phases = [];
  const result = await refreshSongsAndGenres({
    enrichSongsImpl: async ({ tick }) => {
      phases.push("songs");
      tick({ ranked: 0, done: 0, of: 0 });
      return 0;
    },
    beforeGenres: () => phases.push("before-genres"),
    backfillGenresImpl: async ({ tick }) => {
      phases.push("genres");
      tick({ fixed: 1, done: 1, of: 1 });
      return { fixed: 1, scanned: 1, pending: 1 };
    },
  });
  assert.deepEqual(phases, ["songs", "before-genres", "genres"]);
  assert.deepEqual(result, {
    songs: 0,
    genres: { fixed: 1, scanned: 1, pending: 1 },
    stopped: false,
  });
});

test("refresh honors a stop between songs and genres", async () => {
  let stopped = false;
  let genreRuns = 0;
  const result = await refreshSongsAndGenres({
    shouldStop: () => stopped,
    enrichSongsImpl: async () => { stopped = true; return 2; },
    backfillGenresImpl: async () => { genreRuns += 1; return { fixed: 1 }; },
  });
  assert.equal(genreRuns, 0);
  assert.equal(result.stopped, true);
  assert.equal(result.songs, 2);
});

test("genre backfill resumes after its last attempted artist and wraps fairly", () => {
  const rows = [{ norm: "a" }, { norm: "b" }, { norm: "c" }, { norm: "d" }];
  assert.deepEqual(rotateRowsAfterCursor(rows, "b").map((row) => row.norm), ["c", "d", "a", "b"]);
  assert.deepEqual(rotateRowsAfterCursor(rows, "missing").map((row) => row.norm), ["a", "b", "c", "d"]);
});

test("background Deezer enrichment treats an auto-saved identity as a self-healing hint", async () => {
  artistStmts.upsert.run(artistRow("background identity hint", {
    name: "Background Identity Hint",
    deezerId: 7001,
  }, "deezer"));
  let lookupOptions = null;
  const enriched = await deezerEnrich("Background Identity Hint", {
    findArtist: async (_name, options) => {
      lookupOptions = options;
      return null;
    },
  });
  assert.equal(enriched, null);
  assert.deepEqual(lookupOptions, { hintId: 7001 });
  assert.equal(Object.hasOwn(lookupOptions, "preferredId"), false);
});

test("genre backfill saves a corrected Deezer identity while clearing the former proof", () => {
  const evidence = {
    genre: "Pop", provider: "deezer", basis: "release-consensus-v1",
    sampleCount: 3, supportingCount: 2, share: 0.6667,
    counts: [{ genre: "Pop", count: 2 }, { genre: "Rock", count: 1 }],
  };
  assert.equal(mergeGenreBackfillData({ name: "Offline", genre: "Pop" }, { deezerId: 11 }, null), null);

  const merged = mergeGenreBackfillData(
    { name: "Corrected Background Artist", genre: "Pop" },
    {
      deezerId: 11,
      genreClaims: [{ value: "Pop", source: "release_consensus", at: 1 }],
      genreEvidence: evidence,
    },
    { deezerId: 22, genreEvidence: null },
  );
  assert.equal(merged.deezerId, 22);
  assert.deepEqual(merged.genreClaims, []);
  assert.equal(merged.genreEvidence, undefined);
});
