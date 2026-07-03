#!/usr/bin/env node
/**
 * Prune dead photo URLs from the catalog.
 *
 * Many scraped image URLs are 404s or hotlink-protected and never render. This
 * checks every gallery-pool URL (with concurrency), drops the ones that don't
 * return a real image, keeps the working ones (order preserved), and rewrites
 * `photo` / `photos` from what actually loads. Idempotent — safe to re-run.
 *
 *   node scripts/prune-photos.mjs                 # artists + venues
 *   node scripts/prune-photos.mjs --venues        # venues only
 *   node scripts/prune-photos.mjs --artists       # artists only
 *
 * The app also skips broken images at render time, but pruning keeps the data
 * honest (and makes the "N photos" counts real).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CONCURRENCY = 24;
const TIMEOUT_MS = 8000;

// True if the URL returns a real image. Try HEAD first (cheap), fall back to a
// ranged GET (some hosts reject HEAD).
async function loads(url) {
  if (!/^https?:\/\//.test(url)) return false;
  const check = async (method, headers) => {
    try {
      const r = await fetch(url, { method, headers: { "User-Agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      return r.ok && ct.startsWith("image");
    } catch { return false; }
  };
  if (await check("HEAD", {})) return true;
  return check("GET", { Range: "bytes=0-2048" });
}

// Map over items with a fixed concurrency.
async function mapPool(items, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function pruneEntity(e) {
  const pool = e.galleryPool || [];
  if (!pool.length && !e.photo && !(e.photos || []).length) return { checked: 0, kept: 0, dropped: 0 };
  const results = await mapPool(pool, (p) => loads(p.uri));
  const kept = pool.filter((_, idx) => results[idx]);
  const dropped = pool.length - kept.length;
  e.galleryPool = kept;
  e.photos = [...new Set(kept.map((p) => p.uri))].slice(0, 8);
  e.photo = kept[0]?.uri || null;
  e.photoCredit = kept[0]?.credit || e.photoCredit || null;
  return { checked: pool.length, kept: kept.length, dropped };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--venues") ? "venues" : args.includes("--artists") ? "artists" : "both";
  const cat = JSON.parse(await readFile(OUT, "utf8"));

  const groups = [];
  if (only !== "venues") groups.push(["artists", cat.artists || {}]);
  if (only !== "artists") groups.push(["venues", cat.venues || {}]);

  let totChecked = 0, totKept = 0, totDropped = 0, done = 0;
  for (const [label, map] of groups) {
    const keys = Object.keys(map);
    console.log(`Pruning ${keys.length} ${label}…`);
    for (const k of keys) {
      const r = await pruneEntity(map[k]);
      totChecked += r.checked; totKept += r.kept; totDropped += r.dropped;
      if (++done % 40 === 0) {
        console.log(`  …${done} entities · checked ${totChecked}, kept ${totKept}, dropped ${totDropped}`);
        await writeFile(OUT, JSON.stringify(cat, null, 2)); // periodic flush
      }
    }
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`\nDone. Checked ${totChecked} URLs · kept ${totKept} · dropped ${totDropped} dead.`);
}
main();
