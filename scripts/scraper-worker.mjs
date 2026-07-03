#!/usr/bin/env node
/**
 * Continuous scraper worker — NOT a batch run.
 *
 * Runs forever: every few seconds it picks the single STALEST artist or venue
 * (round-robin between the two), fetches fresh photos, writes that one record,
 * and repeats. Progress lives in each record's `updatedAt`, so if you stop and
 * restart it resumes exactly where it left off and keeps the whole catalog fresh
 * on a rolling basis instead of one big periodic dump.
 *
 *   node scripts/scraper-worker.mjs           # run continuously
 *   SLEEP_MS=2000 node scripts/scraper-worker.mjs
 *
 * Photo sources (same tiered, takedown-aware chain as the enrich scripts):
 *   existing Commons  ->  Openverse (licensed)  ->  open web (Bing/Google CSE)
 *
 * Writes are atomic (temp file + rename) and flushed every FLUSH_EVERY records so
 * a crash never corrupts catalog.generated.json.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webImages } from "./lib/web-images.mjs";
import { filterLoadable } from "./lib/img-check.mjs";

const UA = "PitConcertApp/0.1 (https://example.com; contact@example.com)";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SLEEP_MS = Number(process.env.SLEEP_MS) || 3000; // between records
const FLUSH_EVERY = Number(process.env.FLUSH_EVERY) || 6; // records per disk write
const POOL_MAX = 12;
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // refresh anything older than a week

const getJSON = async (url) => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
};
const credit = (r) =>
  [r.creator, [r.license, r.license_version].filter(Boolean).join(" ").toUpperCase(), r.source && `(${r.source})`]
    .filter(Boolean).join(" · ");

async function openverse(query) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&page_size=10&mature=false`;
  const d = await getJSON(url);
  return (d?.results || [])
    .filter((r) => r.url && /\.(jpe?g|png)(\?|$)/i.test(r.url))
    .map((r) => ({ uri: r.url, credit: credit(r), source: "openverse" }));
}

// Build a fresh gallery pool for one entity from the tiered chain.
async function buildPool(entity, kind) {
  const commons = (entity.photos || [])
    .filter((u) => /^https?:\/\//.test(u))
    .map((uri) => ({ uri, credit: entity.photoCredit || "Wikimedia Commons", source: "commons" }));
  const q1 = kind === "artist" ? `"${entity.name}" band` : `"${entity.name}"${entity.place ? " " + entity.place.split(",")[0] : ""}`;
  const q2 = kind === "artist" ? `${entity.name} live concert` : `${entity.name} concert venue`;
  const ov1 = await openverse(q1);
  await sleep(500);
  const ov2 = await openverse(q2);
  await sleep(500);
  const seen = new Set();
  const pool = [];
  const take = (rows) => { for (const r of rows) { if (!r.uri || seen.has(r.uri)) continue; seen.add(r.uri); pool.push(r); if (pool.length >= POOL_MAX) return; } };
  take([...commons, ...ov1, ...ov2]);
  if (pool.length < POOL_MAX) { take(await webImages(q2, POOL_MAX)); await sleep(300); }
  // Continuous prune: keep only URLs that actually answer with an image, so dead
  // and hotlink-blocked links never make it into the catalog in the first place.
  return filterLoadable(pool);
}

// Pick the next entity to work on. Visible blanks first (empty pool), then thin
// pools (<3 usable photos), then whatever is stalest — so the worker heals holes
// before it polishes.
function pickNext(cat) {
  let best = null;
  const consider = (map, kind) => {
    for (const key of Object.keys(map || {})) {
      const e = map[key];
      const poolSize = (e.galleryPool || []).length;
      const tier = poolSize === 0 ? 0 : poolSize < 3 ? 1 : 2;
      const ts = e.updatedAt || 0;
      if (!best || tier < best.tier || (tier === best.tier && ts < best.ts)) {
        best = { kind, key, entity: e, ts, tier };
      }
    }
  };
  consider(cat.artists, "artist");
  consider(cat.venues, "venue");
  return best;
}

let dirty = 0;
async function flush(cat) {
  const tmp = OUT + ".tmp";
  await writeFile(tmp, JSON.stringify(cat, null, 2));
  await rename(tmp, OUT);
  dirty = 0;
}

async function main() {
  console.log(`[worker] starting — one record every ${SLEEP_MS}ms, flush every ${FLUSH_EVERY}.`);
  let running = true;
  process.on("SIGINT", () => { running = false; console.log("\n[worker] stopping after current record…"); });

  // Load once and keep the catalog in memory; flush the whole thing periodically.
  // (Re-reading each iteration would drop not-yet-flushed changes.)
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  cat.artists ||= {}; cat.venues ||= {};
  // Pull in curated app-side venues (arenas.js) so they get photos too — new
  // curated rooms have no updatedAt, so the stalest-first picker does them first.
  const { syncAnchors } = await import("./sync-anchors.mjs");
  const synced = await syncAnchors(cat);
  if (synced) console.log(`[worker] synced ${synced} curated venue(s) into the catalog.`);

  let processed = 0;
  while (running) {
    const target = pickNext(cat);
    if (!target) { await sleep(SLEEP_MS); continue; }

    const now = Date.now();
    // Recently-refreshed entities are skipped — UNLESS their pool is empty/thin
    // (tier < 2): visible holes always get worked.
    const fresh = target.tier === 2 && target.ts && now - target.ts < STALE_MS;
    let changed = false;
    if (!fresh) {
      const pool = await buildPool(target.entity, target.kind);
      if (pool.length) {
        target.entity.galleryPool = pool;
        // photos/photo come FROM the validated pool only — merging the old list
        // back in would resurrect dead URLs.
        target.entity.photos = [...new Set(pool.map((p) => p.uri))].slice(0, 8);
        target.entity.photo = pool[0].uri;
        target.entity.photoCredit = pool[0].credit || target.entity.photoCredit || null;
        changed = true;
      }
    }
    target.entity.updatedAt = now; // advance cursor in memory
    processed++;
    // Only a real change makes the catalog dirty — so once everything is fresh the
    // worker idles WITHOUT rewriting the bundled file (which would hot-reload the app).
    if (changed) {
      dirty++;
      console.log(`[worker] ${processed}: ${target.kind} "${target.entity.name}" -> ${target.entity.galleryPool?.length || 0} photos`);
    }

    if (dirty >= FLUSH_EVERY) { await flush(cat); console.log(`[worker] flushed to catalog.`); }
    // When the whole catalog is fresh there is nothing to do — back off hard so we
    // are not spinning through skips.
    await sleep(fresh ? Math.max(SLEEP_MS, 15000) : SLEEP_MS);
  }
  if (dirty > 0) { await flush(cat); console.log(`[worker] final flush.`); }
  console.log("[worker] stopped.");
}
main();
