#!/usr/bin/env node
/**
 * Free, keyless venue photos — Wikimedia Commons geo-search around each venue's
 * coordinates. Real, CC-licensed photos (variable: usually the building/street).
 *   node scripts/ingest-venue-photos.mjs
 * Fills venues[].photos / .photo in src/seed/catalog.generated.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (https://example.com; contact@example.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const fileUrl = (title) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title.replace(/^File:/, ""))}?width=1200`;

async function photosNear(lat, lng) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=geosearch&gscoord=${lat}%7C${lng}&gsradius=1200&gslimit=14&gsnamespace=6`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const data = await res.json();
    return (data.query?.geosearch || [])
      .map((g) => g.title)
      .filter((t) => /\.(jpe?g)$/i.test(t))
      .slice(0, 6)
      .map(fileUrl);
  } catch {
    return [];
  }
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const venues = cat.venues || {};
  const keys = Object.keys(venues).filter((k) => venues[k].lat != null);
  console.log(`Fetching Commons photos for ${keys.length} venues…`);
  let withPhotos = 0, done = 0;
  for (const k of keys) {
    const v = venues[k];
    const photos = await photosNear(v.lat, v.lng);
    if (photos.length) { v.photos = photos; v.photo = photos[0]; v.photoCredit = "Wikimedia Commons"; withPhotos++; }
    if (++done % 40 === 0) console.log(`  …${done}/${keys.length} (${withPhotos} with photos)`);
    await sleep(180);
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${withPhotos}/${keys.length} venues now have photos.`);
}
main();
