import test from "node:test";
import assert from "node:assert/strict";
import {
  crawlerGenreFields, growOutcome, refreshSongsAndGenres,
  deezerEnrich, mergeGenreBackfillData, rotateRowsAfterCursor, shouldEnrichAfterCrawl,
} from "./catalogSeed.js";
import { displayGenre, resolveGenre, storedClaims } from "../src/domain/genre.mjs";
import { artistRow, artistStmts } from "./db.js";

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
