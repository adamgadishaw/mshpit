// Discover YouTube channels for the catalogue from Wikidata — free, no search
// quota. Run it once (and after big ingests) to remove the discovery-search cost
// for the notable slice of the catalogue, which is most of what people play.
//
//   node scripts/backfill-channels.mjs                 # whole catalogue
//   node scripts/backfill-channels.mjs --limit 500     # just the top N
//
// A YOUTUBE_API_KEY is optional: with it, the backfill prefers each artist's
// "- Topic" channel (full discography); without it, the primary channel. Either
// way this spends ZERO of the daily search budget.

import { backfillChannelsFromWikidata } from "../server/wikidataChannels.js";
import { db } from "../server/db.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const before = db.prepare("SELECT COUNT(*) c FROM artists WHERE youtube_channel_id IS NOT NULL").get().c;
console.log(`Starting: ${before} artists already have a channel. Querying Wikidata (free)…`);

let lastError = null;

const stats = await backfillChannelsFromWikidata({
  limit: Math.max(1, Number(arg("limit", 5000))),
  onProgress: (s) => {
    if (s.error) lastError = `${s.code || "wikidata_error"}: ${s.error}`;
    process.stdout.write(`\r  batch ${s.batches}: ${s.stored} artist rows stored / ${s.matched} identities matched / ${s.failedBatches} failed  `);
  },
});

const after = db.prepare("SELECT COUNT(*) c FROM artists WHERE youtube_channel_id IS NOT NULL").get().c;
console.log(`\nDone. Considered ${stats.considered}, matched ${stats.matched}, stored ${stats.stored}.`);
console.log(`Catalogue channel coverage: ${before} -> ${after} (+${after - before}). Zero search quota spent.`);
if (stats.failedBatches) {
  console.error(`Backfill incomplete: ${stats.failedBatches} batch(es) failed and ${stats.deferred} identities remain eligible.${lastError ? ` Last error: ${lastError}` : ""}`);
  process.exitCode = 1;
}
