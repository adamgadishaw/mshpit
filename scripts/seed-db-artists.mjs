#!/usr/bin/env node
/**
 * Seed the DB artist catalog toward ~10k artists across ALL genres, keyless.
 * Thin CLI over server/catalogSeed.js (same code the admin console runs), so the
 * two never drift. DB-backed (not the bundle) → scales without bundle bloat; the
 * artist page pulls songs/albums (with previews) from Deezer on demand, so every
 * seeded artist is playable without a song scrape.
 *
 * Idempotent + resumable (WAL-safe to run while the web service is live).
 *
 *   local:   node scripts/seed-db-artists.mjs --add 10000
 *   Render:  PIT_DATA_DIR=/data node scripts/seed-db-artists.mjs --add 10000
 *
 * Flags: --add N (grow BY N artists, default 10000) · --per-tag N (crawl
 *        depth/genre, default 600) · --no-enrich (crawl only) · --enrich-only
 *        (skip crawl, rank thin rows).
 */
import { crawlArtists, enrichThin } from "../server/catalogSeed.js";
import { artistStmts } from "../server/db.js";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const add = Number(flag("--add", 10000)) || 10000;
const perTag = Number(flag("--per-tag", 600)) || 600;

(async () => {
  const t0 = Date.now();
  if (!args.includes("--enrich-only")) {
    const start = artistStmts.count.get().c;
    const target = start + add;
    console.log(`Crawl → grow by ${add} to ${target} (DB has ${start})…`);
    const added = await crawlArtists({ target, perTag, tick: ({ added, total, note }) => console.log(`  +${added} (DB ${total}) · ${note}`) });
    console.log(`Crawl done: +${added} (DB now ${artistStmts.count.get().c}).`);
  }
  if (!args.includes("--no-enrich")) {
    console.log(`Enrich thin rows via Deezer…`);
    const ranked = await enrichThin({ tick: ({ ranked, done, of }) => console.log(`  …${done}/${of} (${ranked} ranked)`) });
    console.log(`Enrich done: ${ranked} ranked.`);
  }
  console.log(`\nAll done in ${Math.round((Date.now() - t0) / 1000)}s. DB total: ${artistStmts.count.get().c} artists.`);
})();
