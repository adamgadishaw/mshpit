#!/usr/bin/env node
/**
 * Seed the DB artist catalog toward ~10k artists across ALL genres, keyless.
 * Thin CLI over server/catalogSeed.js (same code the admin console runs), so the
 * two never drift. DB-backed (not the bundle) → scales without bundle bloat; the
 * artist page pulls songs/albums from Deezer on demand and resolves a fresh
 * preview only when played, so every seeded artist is playable without storing
 * expiring links.
 * seeded artist is playable without a song scrape.
 *
 * Idempotent + resumable (WAL-safe to run while the web service is live).
 *
 *   local:   node scripts/seed-db-artists.mjs --add 10000
 *   Render:  PIT_DATA_DIR=/data node scripts/seed-db-artists.mjs --add 10000
 *
 * Flags: --add N (grow BY N artists, default 10000) · --per-tag N (crawl
 *        absolute depth/genre; default resumes beyond the deepest cursor) ·
 *        --no-enrich (crawl only) · --enrich-only
 *        (skip crawl, rank thin rows).
 */
import { crawlArtists, enrichThin } from "../server/catalogSeed.js";
import { artistStmts, db } from "../server/db.js";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const add = Number(flag("--add", 10000)) || 10000;
const requestedDepth = Number(flag("--per-tag", 0)) || 0;
const currentDepth = db.prepare("SELECT COALESCE(MAX(next_off),0) n FROM seed_cursor").get().n;
const perTag = requestedDepth > currentDepth ? requestedDepth : currentDepth + 1200;

(async () => {
  const t0 = Date.now();
  if (!args.includes("--enrich-only")) {
    const start = artistStmts.count.get().c;
    const target = start + add;
    console.log(`Crawl → grow by ${add} to ${target} (DB has ${start})…`);
    const result = await crawlArtists({ target, perTag, tick: ({ added, total, note }) => console.log(`  +${added} (DB ${total}) · ${note}`) });
    console.log(`Crawl done: +${result.added} across ${result.pages} pages (DB now ${artistStmts.count.get().c}).`);
  }
  if (!args.includes("--no-enrich")) {
    console.log(`Enrich thin rows via Deezer…`);
    const ranked = await enrichThin({ tick: ({ ranked, done, of }) => console.log(`  …${done}/${of} (${ranked} ranked)`) });
    console.log(`Enrich done: ${ranked} ranked.`);
  }
  console.log(`\nAll done in ${Math.round((Date.now() - t0) / 1000)}s. DB total: ${artistStmts.count.get().c} artists.`);
})();
