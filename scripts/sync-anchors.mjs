#!/usr/bin/env node
/**
 * Sync curated app-side venues into the scrapeable catalog.
 *
 * Root cause this kills: curated venue lists in app code (src/seed/arenas.js —
 * and any future ones) merge into catalogVenues at RUNTIME, but every scraper /
 * enricher / pruner iterates catalog.generated.json. Anything curated-only was
 * invisible to the photo pipeline forever — which is exactly why flagship rooms
 * like Budweiser Stage, History, and MetLife Stadium sat blank while 964 scraped
 * venues had full galleries.
 *
 * This script (also called automatically by enrich-venue-photos.mjs and the
 * continuous worker) copies any curated venue missing from the generated catalog
 * into it, so the photo pipeline sees the SAME venue universe as the app.
 *
 *   node scripts/sync-anchors.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "seed", "catalog.generated.json");

export async function syncAnchors(cat) {
  const { arenaVenues } = await import("../src/seed/arenas.js");
  cat.venues ||= {};
  let added = 0;
  for (const [key, v] of Object.entries(arenaVenues)) {
    if (!cat.venues[key]) {
      cat.venues[key] = { name: v.name, place: v.place, lat: v.lat, lng: v.lng, capacity: v.capacity ?? null, photo: null, photoCredit: null, major: !!v.major };
      added++;
    }
  }
  return added;
}

// CLI entry
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const added = await syncAnchors(cat);
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Synced curated venues into catalog: +${added} new (of ${Object.keys((await import("../src/seed/arenas.js")).arenaVenues).length} curated).`);
}
