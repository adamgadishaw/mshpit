// Warm the YouTube video cache before real traffic arrives.
//
// Quota is per Google Cloud project, not per user, so a resolved song is free
// for everyone who plays it afterwards. What costs quota is a song nobody has
// resolved yet — which means a cold cache degrades every first listen to a
// 30-second preview, and a busy launch day spends the whole daily budget on
// songs that could have been resolved overnight for nothing.
//
// This walks the catalogue most-popular-first and resolves each artist's top
// tracks through the normal lookup, so it fills the same cache the app reads.
// It is safe to stop and re-run: cached songs are skipped, and progress is
// recorded in app_meta so the next run resumes where this one stopped.
//
//   node scripts/warm-youtube-cache.mjs            # default budget
//   node scripts/warm-youtube-cache.mjs --budget 5000
//   node scripts/warm-youtube-cache.mjs --artists 200 --dry-run
//
// The budget is in QUOTA UNITS, not songs. An artist catalogue costs ~13 units
// and covers their whole discography; a fallback search costs 100. The default
// leaves headroom under a 10,000/day allowance for real users.

import { db, ytStmts, normName } from "../server/db.js";
import { resolveYouTubeTrack, youtubeProviderStatus } from "../server/musicProviders.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BUDGET = Math.max(1, Number(arg("budget", 8000)));
const ARTIST_LIMIT = Math.max(1, Number(arg("artists", 400)));
const TRACKS_PER_ARTIST = Math.max(1, Number(arg("tracks", 5)));
const DRY_RUN = flag("dry-run");
const PROGRESS_KEY = "warm:youtube:v1";

// Rough quota accounting, matching what the resolver actually spends: the first
// song for an artist pulls their channel and uploads catalogue, and later songs
// for the same artist reuse it. A fallback search is the expensive path.
const COST_FIRST_TRACK = 13;
const COST_CACHED_ARTIST = 2;

if (!process.env.YOUTUBE_API_KEY) {
  console.error("YOUTUBE_API_KEY is not set. Nothing to warm — every lookup would return 'unconfigured'.");
  process.exit(1);
}

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

const cachedAlready = (title, artist) => {
  try {
    const key = `${normName(artist)}|${normName(title)}`;
    const hit = ytStmts.get.get(key);
    return !!(hit && hit.video_id && Number(hit.expires_at) > Date.now());
  } catch { return false; }
};

const progress = readProgress();
const done = new Set(progress.done || []);

// Most popular first: those are the songs people actually reach for, so a run
// that is cut short still bought the most benefit.
const artists = db.prepare(`
  SELECT name, popularity, data FROM artists
  WHERE data IS NOT NULL
  ORDER BY COALESCE(popularity, 0) DESC, rank_score DESC
  LIMIT ?
`).all(ARTIST_LIMIT);

let spent = 0;
let resolved = 0;
let skipped = 0;
let failed = 0;
let artistsTouched = 0;

console.log(`Warming up to ${artists.length} artists, ${TRACKS_PER_ARTIST} tracks each, budget ${BUDGET} quota units${DRY_RUN ? " (dry run)" : ""}.`);

for (const row of artists) {
  if (spent >= BUDGET) { console.log("\nBudget reached."); break; }
  if (done.has(normName(row.name))) continue;

  let data = {};
  try { data = JSON.parse(row.data || "{}"); } catch { continue; }
  const tracks = (data.topTracks || []).filter((t) => t?.title).slice(0, TRACKS_PER_ARTIST);
  if (!tracks.length) { done.add(normName(row.name)); continue; }

  artistsTouched++;
  let firstForArtist = true;

  for (const track of tracks) {
    if (spent >= BUDGET) break;
    if (cachedAlready(track.title, row.name)) { skipped++; continue; }

    if (DRY_RUN) {
      spent += firstForArtist ? COST_FIRST_TRACK : COST_CACHED_ARTIST;
      firstForArtist = false;
      resolved++;
      continue;
    }

    try {
      const result = await resolveYouTubeTrack(track.title, row.name, { expectedDurationSec: Number(track.duration) || 0 });
      spent += firstForArtist ? COST_FIRST_TRACK : COST_CACHED_ARTIST;
      firstForArtist = false;
      if (result?.videoId) resolved++;
      else failed++;

      // Stop the moment the server's own circuit breaker trips, rather than
      // hammering a provider that has already said no.
      const status = youtubeProviderStatus();
      if (status.circuitOpen) {
        console.log(`\nProvider paused (${status.circuitCode}). Stopping so the daily budget is not burned on errors.`);
        spent = BUDGET;
        break;
      }
    } catch (error) {
      failed++;
      console.log(`  ! ${row.name} — ${track.title}: ${error?.message || error}`);
    }

    // Be a polite client; this job is never in a hurry.
    await new Promise((r) => setTimeout(r, 120));
  }

  done.add(normName(row.name));
  if (!DRY_RUN && artistsTouched % 10 === 0) {
    writeProgress({ done: [...done], at: Date.now() });
    console.log(`  ${artistsTouched} artists · ${resolved} resolved · ${skipped} already cached · ${failed} unmatched · ~${spent} units`);
  }
}

if (!DRY_RUN) writeProgress({ done: [...done], at: Date.now() });

console.log(`\nDone. ${artistsTouched} artists touched, ${resolved} songs resolved, ${skipped} already cached, ${failed} unmatched.`);
console.log(`Approximately ${spent} quota units spent${DRY_RUN ? " (estimated; nothing was requested)" : ""}.`);
console.log(DRY_RUN
  ? "Dry run: no progress was recorded and no quota was spent."
  : `Progress saved under app_meta '${PROGRESS_KEY}' — re-run to continue where this stopped.`);
