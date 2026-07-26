// Warm the YouTube video cache before real traffic needs it.
//
// Quota is per Google Cloud project, not per user, so once a song is resolved it
// is free for everyone who plays it afterwards. A cold cache is the problem: the
// first person to reach for a song pays the lookup, and until it lands they get
// a 30-second preview. Resolving the popular catalogue ahead of time turns that
// first listen into the real video and keeps a launch day from spending the
// whole daily search budget on songs that could have been warmed for nothing.
//
// The warm path uses the artist-catalogue lookup (channels + uploads, ~13 quota
// units for a whole discography) rather than search (100 units each, and capped
// at 90/day for users). So warming is cheap AND it does not touch the search
// budget real users depend on.
//
// This module is the shared core: the CLI (scripts/warm-youtube-cache.mjs) and
// the in-process daily scheduler both call warmYouTubeCache. The resolver and
// clock are injectable so the accounting is testable without a real key.

import { db, ytStmts, normName } from "./db.js";
import { resolveYouTubeTrack, youtubeProviderStatus } from "./musicProviders.js";

const PROGRESS_KEY = "warm:youtube:v1";
const DAILY_MARKER_KEY = "warm:youtube:lastRun";

// Rough quota accounting that matches what the resolver actually spends: the
// first song for an artist pulls their channel + uploads catalogue, later songs
// for that artist reuse it, and a fallback search is the expensive path.
export const COST_FIRST_TRACK = 13;
export const COST_CACHED_ARTIST = 2;

const readProgress = () => {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(PROGRESS_KEY);
    return row ? JSON.parse(row.value) : { done: [] };
  } catch { return { done: [] }; }
};
const writeProgress = (progress) => {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(PROGRESS_KEY, JSON.stringify(progress));
};

const isCached = (title, artist) => {
  try {
    const hit = ytStmts.get.get(`${normName(artist)}|${normName(title)}`);
    return !!(hit && hit.video_id && Number(hit.expires_at) > Date.now());
  } catch { return false; }
};

/**
 * Warm the cache for the most-popular slice of the catalogue.
 *
 * @param budget          quota units to spend before stopping
 * @param artistLimit     how far down the popularity list to walk
 * @param tracksPerArtist top-N songs per artist to resolve
 * @param dryRun          estimate coverage/cost, request nothing, record nothing
 * @param resolve         the resolver (injectable for tests)
 * @param providerStatus  circuit-breaker probe (injectable for tests)
 * @param onProgress      optional callback every 10 artists
 * @param sleep           delay between requests (0 in tests)
 */
export async function warmYouTubeCache({
  budget = 8000,
  artistLimit = 400,
  tracksPerArtist = 5,
  dryRun = false,
  resolve = resolveYouTubeTrack,
  providerStatus = youtubeProviderStatus,
  onProgress = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  sleepMs = 120,
} = {}) {
  const progress = readProgress();
  const done = new Set(progress.done || []);

  // What people ACTUALLY play comes first. The daily search budget is tiny (~90
  // discoveries), so a popularity-only walk spends it on famous artists and
  // never reaches the older/niche tracks a listener is actually queuing — which
  // then preview forever, because once the budget is gone their channel can
  // never be discovered or stored. So the warmer leads with artists that have
  // been played but whose Topic channel was never found (youtube_channel_at=0),
  // most-played first. Those are precisely the songs producing previews now.
  const played = db.prepare(`
    SELECT a.name, a.popularity, a.data
    FROM artists a
    JOIN (
      SELECT lower(artist) AS k, COUNT(*) AS c, MAX(created_at) AS recent
      FROM plays WHERE artist IS NOT NULL AND artist <> ''
      GROUP BY lower(artist)
    ) p ON lower(a.name) = p.k
    WHERE a.data IS NOT NULL AND a.youtube_channel_at = 0
    ORDER BY p.c DESC, p.recent DESC
    LIMIT ?
  `).all(artistLimit);

  // Then the popularity walk fills the rest of the budget, so a fresh install
  // with no play history still warms the obvious catalogue.
  const popular = db.prepare(`
    SELECT name, popularity, data FROM artists
    WHERE data IS NOT NULL
    ORDER BY COALESCE(popularity, 0) DESC, rank_score DESC
    LIMIT ?
  `).all(artistLimit);

  const seen = new Set();
  const artists = [];
  for (const row of [...played, ...popular]) {
    const key = normName(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    artists.push(row);
  }

  const stats = { artistsTouched: 0, resolved: 0, skipped: 0, failed: 0, spent: 0, stoppedEarly: false };

  for (const row of artists) {
    if (stats.spent >= budget) { stats.stoppedEarly = true; break; }
    if (done.has(normName(row.name))) continue;

    let data = {};
    try { data = JSON.parse(row.data || "{}"); } catch { continue; }
    const tracks = (data.topTracks || []).filter((t) => t?.title).slice(0, tracksPerArtist);
    if (!tracks.length) { done.add(normName(row.name)); continue; }

    stats.artistsTouched++;
    let firstForArtist = true;

    for (const track of tracks) {
      if (stats.spent >= budget) { stats.stoppedEarly = true; break; }
      if (isCached(track.title, row.name)) { stats.skipped++; continue; }

      if (dryRun) {
        stats.spent += firstForArtist ? COST_FIRST_TRACK : COST_CACHED_ARTIST;
        firstForArtist = false;
        stats.resolved++;
        continue;
      }

      try {
        const result = await resolve(track.title, row.name, { expectedDurationSec: Number(track.duration) || 0 });
        stats.spent += firstForArtist ? COST_FIRST_TRACK : COST_CACHED_ARTIST;
        firstForArtist = false;
        if (result?.videoId) stats.resolved++; else stats.failed++;

        // Stop the moment the server's own circuit breaker trips: do not keep
        // hammering a provider that has already said no, and do not burn the
        // day's budget on errors.
        if (providerStatus()?.circuitOpen) { stats.stoppedEarly = true; stats.spent = budget; break; }
      } catch {
        stats.failed++;
      }
      if (sleepMs) await sleep(sleepMs);
    }

    done.add(normName(row.name));
    if (!dryRun && stats.artistsTouched % 10 === 0) {
      writeProgress({ done: [...done], at: Date.now() });
      onProgress?.(stats);
    }
  }

  if (!dryRun) writeProgress({ done: [...done], at: Date.now() });
  return stats;
}

// Reset the resume cursor, so the next run re-checks the whole catalogue. Used
// by the daily scheduler once every artist has been walked, so newly enriched
// tracks and expired cache entries get picked up on the next pass.
export function resetWarmProgress() {
  writeProgress({ done: [], at: Date.now() });
}

const dayStamp = (now) => new Date(now).toISOString().slice(0, 10);

// Whether a warm pass has already run today, so a redeploy (which restarts the
// process) does not trigger a fresh full warm every time code ships.
function ranToday(now = Date.now()) {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(DAILY_MARKER_KEY);
    return row?.value === dayStamp(now);
  } catch { return false; }
}
function markRanToday(now = Date.now()) {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(DAILY_MARKER_KEY, dayStamp(now));
}

// The in-process daily job. Mirrors startTourDateScheduler: idle without a key,
// runs a bounded pass shortly after boot, then every 24h. The per-day marker
// keeps a deploy from re-warming, and the small default budget spends catalogue
// units (not the user-facing search budget), so this never starves real
// playback.
export function startCacheWarmScheduler({
  budget = Number(process.env.YOUTUBE_WARM_BUDGET) || 1500,
  intervalMs = 24 * 60 * 60 * 1000,
} = {}) {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log("[pit] cache warmer idle, set YOUTUBE_API_KEY to enable.");
    return;
  }
  console.log(`[pit] cache warmer on (daily, ~${budget} quota units/day via artist catalogues).`);

  const runOnce = async () => {
    if (ranToday()) return;
    try {
      const stats = await warmYouTubeCache({ budget });
      markRanToday();
      console.log(`[pit] cache warm: ${stats.resolved} resolved, ${stats.skipped} already cached, ${stats.failed} unmatched, ~${stats.spent} units.`);
    } catch (error) {
      console.log(`[pit] cache warm failed: ${error?.message || error}`);
    }
  };

  // A minute after boot, not immediately: let the server settle and serve
  // traffic first. This job is never in a hurry.
  setTimeout(runOnce, 60 * 1000).unref();
  setInterval(runOnce, intervalMs).unref();
}
