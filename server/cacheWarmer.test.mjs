import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PIT_DATA_DIR = mkdtempSync(join(tmpdir(), "pit-warm-"));

const { db } = await import("./db.js");
const { warmYouTubeCache, COST_FIRST_TRACK, COST_CACHED_ARTIST, resetWarmProgress } = await import("./cacheWarmer.js");

// Seed a few artists with top tracks, most-popular first, and clear the resume
// cursor between tests so each starts fresh.
function seed(artists) {
  db.prepare("DELETE FROM artists").run();
  db.prepare("DELETE FROM app_meta WHERE key LIKE 'warm:%'").run();
  db.prepare("DELETE FROM yt_cache").run();
  const ins = db.prepare("INSERT INTO artists (norm,name,popularity,rank_score,data,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
  for (const a of artists) {
    ins.run(a.name.toLowerCase(), a.name, a.popularity, a.popularity,
      JSON.stringify({ topTracks: a.tracks.map((t) => ({ title: t, duration: 200 })) }), "test", 1, 1);
  }
}

// A resolver that records what it was asked and always "finds" a video, unless
// told to fail a specific title.
function fakeResolver({ fail = new Set() } = {}) {
  const calls = [];
  const resolve = async (title, artist) => {
    calls.push(`${artist}|${title}`);
    return fail.has(title) ? { videoId: null, status: "not_found" } : { videoId: "vid_" + calls.length };
  };
  return { resolve, calls };
}

const noSleep = { sleepMs: 0 };
const noCircuit = () => ({ circuitOpen: false });

test("a dry run estimates cost and coverage without resolving or recording anything", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const { resolve, calls } = fakeResolver();
  const stats = await warmYouTubeCache({ dryRun: true, resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls.length, 0, "dry run must not call the resolver");
  assert.equal(stats.resolved, 3, "3 tracks would be resolved");
  // A(first 13 + second 2) + B(first 13) = 28
  assert.equal(stats.spent, COST_FIRST_TRACK * 2 + COST_CACHED_ARTIST);
  // Nothing recorded, so a real run afterwards still has work to do.
  const marker = db.prepare("SELECT value FROM app_meta WHERE key='warm:youtube:v1'").get();
  assert.equal(marker, undefined);
});

test("popular artists are warmed first, and the first track costs more than the rest", async () => {
  seed([{ name: "Popular", popularity: 99, tracks: ["p1", "p2", "p3"] }, { name: "Niche", popularity: 10, tracks: ["n1"] }]);
  const { resolve, calls } = fakeResolver();
  const stats = await warmYouTubeCache({ resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls[0], "Popular|p1", "the most popular artist is resolved first");
  assert.equal(stats.resolved, 4);
  // Popular(13 + 2 + 2) + Niche(13) = 30
  assert.equal(stats.spent, COST_FIRST_TRACK * 2 + COST_CACHED_ARTIST * 2);
});

test("a budget stops the run early and marks it, leaving the rest for next time", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2", "a3"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const { resolve, calls } = fakeResolver();
  // Budget only covers A's first track (13); the next would push past it.
  const stats = await warmYouTubeCache({ budget: 13, resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(stats.stoppedEarly, true);
  assert.ok(calls.length >= 1 && calls.length <= 2, "stops within a track of the budget");
});

test("already-cached songs are skipped, not re-resolved", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2"] }]);
  // Pretend a1 is already cached and fresh.
  db.prepare("INSERT INTO yt_cache (key,video_id,updated_at,expires_at,rejected_ids) VALUES (?,?,?,?,?)")
    .run("a|a1", "already", Date.now(), Date.now() + 60_000, "[]");
  const { resolve, calls } = fakeResolver();
  const stats = await warmYouTubeCache({ resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(calls.includes("A|a1"), false, "the cached song is not resolved again");
  assert.equal(stats.skipped, 1);
  assert.equal(stats.resolved, 1);
});

test("a resume run skips artists already done in a previous pass", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const first = fakeResolver();
  await warmYouTubeCache({ resolve: first.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(first.calls.length, 2, "first pass resolves both");
  // Second pass with a fresh resolver: both artists are marked done, so nothing
  // is re-resolved. (yt_cache is not populated by the fake, so only the resume
  // cursor prevents rework here.)
  const second = fakeResolver();
  const stats = await warmYouTubeCache({ resolve: second.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(second.calls.length, 0, "already-done artists are skipped on resume");
  assert.equal(stats.artistsTouched, 0);
});

test("resetting progress makes the next run re-walk the catalogue", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1"] }]);
  await warmYouTubeCache({ resolve: fakeResolver().resolve, providerStatus: noCircuit, ...noSleep });
  resetWarmProgress();
  const again = fakeResolver();
  await warmYouTubeCache({ resolve: again.resolve, providerStatus: noCircuit, ...noSleep });
  assert.equal(again.calls.length, 1, "after a reset the artist is warmed again");
});

test("a tripped circuit breaker stops the run instead of hammering the provider", async () => {
  seed([{ name: "A", popularity: 90, tracks: ["a1", "a2", "a3"] }, { name: "B", popularity: 80, tracks: ["b1"] }]);
  const { resolve, calls } = fakeResolver();
  let open = false;
  const providerStatus = () => ({ circuitOpen: open });
  // Trip the breaker after the first resolve.
  const trippingResolve = async (t, a, o) => { const r = await resolve(t, a, o); open = true; return r; };
  const stats = await warmYouTubeCache({ resolve: trippingResolve, providerStatus, ...noSleep });
  assert.equal(calls.length, 1, "stops after the breaker opens");
  assert.equal(stats.stoppedEarly, true);
});
