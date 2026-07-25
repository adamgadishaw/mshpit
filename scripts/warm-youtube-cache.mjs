// Warm the YouTube video cache before real traffic arrives (manual runner).
//
// The warming logic lives in server/cacheWarmer.js so the in-process daily
// scheduler and this CLI share one implementation. This is the operator's tool
// for a big one-off warm (before a launch, say) or for estimating cost.
//
//   node scripts/warm-youtube-cache.mjs                 # default budget
//   node scripts/warm-youtube-cache.mjs --budget 5000
//   node scripts/warm-youtube-cache.mjs --artists 200 --dry-run
//
// The budget is in QUOTA UNITS, not songs: an artist catalogue is ~13 units and
// covers their whole discography; a fallback search is 100. A dry run estimates
// coverage and cost, requests nothing, and needs no API key.

import { warmYouTubeCache } from "../server/cacheWarmer.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const budget = Math.max(1, Number(arg("budget", 8000)));
const artistLimit = Math.max(1, Number(arg("artists", 400)));
const tracksPerArtist = Math.max(1, Number(arg("tracks", 5)));
const dryRun = flag("dry-run");

// A real warm needs the key; a dry run does not, because it requests nothing.
if (!dryRun && !process.env.YOUTUBE_API_KEY) {
  console.error("YOUTUBE_API_KEY is not set. Every lookup would return 'unconfigured'.");
  console.error("Run with --dry-run to estimate coverage and cost without a key.");
  process.exit(1);
}

console.log(`Warming up to ${artistLimit} artists, ${tracksPerArtist} tracks each, budget ${budget} quota units${dryRun ? " (dry run)" : ""}.`);

const stats = await warmYouTubeCache({
  budget,
  artistLimit,
  tracksPerArtist,
  dryRun,
  onProgress: (s) => console.log(`  ${s.artistsTouched} artists · ${s.resolved} resolved · ${s.skipped} already cached · ${s.failed} unmatched · ~${s.spent} units`),
});

console.log(`\nDone. ${stats.artistsTouched} artists touched, ${stats.resolved} songs ${dryRun ? "would be resolved" : "resolved"}, ${stats.skipped} already cached, ${stats.failed} unmatched.`);
console.log(`Approximately ${stats.spent} quota units${dryRun ? " (estimated; nothing was requested)" : " spent"}.`);
console.log(dryRun
  ? "Dry run: no progress was recorded and no quota was spent."
  : "Progress saved — re-run to continue where this stopped.");
