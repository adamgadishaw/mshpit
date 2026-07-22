// Measure how often playback actually gets a real recording, so item 7 of the
// backlog ("reduce preview-only playback") can be argued from numbers instead of
// impressions.
//
//   node --env-file=.env scripts/sample-playback.mjs [sampleSize] [--deep]
//
// Draws a sample of songs from the catalogue, asks the resolver for each one,
// and reports the rate of each outcome:
//
//   official   a YouTube recording was resolved and is embeddable
//   preview    no acceptable video, but Deezer has a 30s preview (honest fallback)
//   missing    nothing playable at all
//   capacity   the search budget or circuit breaker refused the lookup, which is
//              a capacity signal and must NOT be read as "song missing"
//   rejected   candidates were found but all scored too low (karaoke, lyric
//              videos, reactions, wrong artist) — the guard working, not a fault
//
// `--deep` samples from the back catalogue instead of top tracks, which is where
// preview-only playback concentrates. Run it before and after a deployment and
// keep both outputs; the acceptance criterion is a before/after comparison, not
// a single number.
import { db } from "../server/db.js";
import { resolveYouTubeTrack, youtubeProviderStatus, getFreshDeezerPreview } from "../server/musicProviders.js";

const sampleSize = Number(process.argv.find((a) => /^\d+$/.test(a))) || 40;
const deep = process.argv.includes("--deep");

const rows = db.prepare(`SELECT name, data FROM artists
  WHERE data LIKE '%"topTracks":[{%'
  ORDER BY popularity DESC`).all();

// Spread the sample across the catalogue rather than taking the head of it, so
// one very popular artist cannot flatter the result.
const songs = [];
const stride = Math.max(1, Math.floor(rows.length / Math.max(1, sampleSize)));
for (let i = 0; i < rows.length && songs.length < sampleSize; i += stride) {
  let data = {};
  try { data = JSON.parse(rows[i].data || "{}"); } catch { continue; }
  const tracks = data.topTracks || [];
  if (!tracks.length) continue;
  // Deep sampling takes from the tail of the discography, where a lookup is
  // least likely to find an official upload.
  const track = deep ? tracks[tracks.length - 1] : tracks[0];
  if (track?.title) songs.push({ artist: rows[i].name, title: track.title, duration: track.duration || 0 });
}

const status = youtubeProviderStatus();
console.log(`sampling ${songs.length} songs (${deep ? "deep catalogue" : "top tracks"})`);
console.log(`youtube configured: ${!!process.env.YOUTUBE_API_KEY} · search budget remaining: ${status.search.remaining}/${status.search.limit}`);
if (!process.env.YOUTUBE_API_KEY) {
  console.log("NOTE: without YOUTUBE_API_KEY every song can only fall back to preview, so the");
  console.log("      official rate below is not meaningful. Run this where the key is set.");
}

const outcome = { official: 0, preview: 0, missing: 0, capacity: 0, rejected: 0 };
const examples = [];

for (const song of songs) {
  let result = null;
  let capacity = false;
  try {
    result = await resolveYouTubeTrack(song.title, song.artist, { expectedDurationSec: song.duration });
  } catch (error) {
    // A refused lookup is a capacity fact, not evidence about the song.
    capacity = true;
    examples.push({ ...song, outcome: "capacity", detail: error?.code || error?.message });
  }

  if (capacity) { outcome.capacity++; continue; }

  if (result?.videoId) {
    outcome.official++;
    continue;
  }

  const rejectedAll = result?.status === "rejected" || result?.status === "no_match";
  let preview = null;
  try { preview = await getFreshDeezerPreview(song.title, song.artist); } catch { preview = null; }

  if (preview?.preview) {
    outcome.preview++;
    examples.push({ ...song, outcome: "preview", detail: result?.status || "no video" });
  } else if (rejectedAll) {
    outcome.rejected++;
    examples.push({ ...song, outcome: "rejected", detail: result?.status });
  } else {
    outcome.missing++;
    examples.push({ ...song, outcome: "missing", detail: result?.status || "none" });
  }
}

const total = songs.length || 1;
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
console.log("\nrates");
for (const [name, count] of Object.entries(outcome)) {
  console.log(`  ${name.padEnd(9)} ${String(count).padStart(4)}  ${pct(count)}`);
}

console.log("\nfirst non-official results (for spot-checking whether the call was right):");
for (const e of examples.slice(0, 12)) {
  console.log(`  [${e.outcome}] ${e.artist} — ${e.title}${e.detail ? ` (${e.detail})` : ""}`);
}

const after = youtubeProviderStatus();
console.log(`\nsearch budget used by this run: ${after.search.used - status.search.used}`);
console.log(`circuit open: ${after.circuitOpen}${after.circuitCode ? ` (${after.circuitCode})` : ""}`);
process.exit(0);
