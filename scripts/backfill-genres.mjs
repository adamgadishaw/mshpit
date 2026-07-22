// Ask Deezer what each artist actually is, so the catalogue stops relying on
// MusicBrainz crawl buckets it was never entitled to state as fact.
//
//   node scripts/backfill-genres.mjs [limit]
//
// Most-popular first and resumable: every run only touches artists that still
// lack an evidence-backed genre, so it can be stopped and re-run. Staff
// corrections are never overwritten. Keyless (Deezer), rate-limited by the
// seeder, so it is safe to run against production data.
import { backfillGenres } from "../server/catalogSeed.js";

const limit = Number(process.argv[2]) || 500;
let stopping = false;
process.on("SIGINT", () => { stopping = true; console.log("\nstopping after the current artist…"); });

console.log(`backfilling genres for up to ${limit} artists (most popular first)`);
const result = await backfillGenres({
  limit,
  shouldStop: () => stopping,
  tick: ({ fixed, done, of }) => console.log(`  ${done}/${of} checked · ${fixed} given real evidence`),
});
console.log(`done: ${result.fixed} of ${result.scanned} checked now have provider-backed genres (${result.pending} were pending)`);
process.exit(0);
