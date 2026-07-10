#!/usr/bin/env node
/**
 * Enrich artists with a POPULARITY signal + photos from Deezer (keyless, no
 * restrictions). This replaces Spotify for ranking: as of the Nov-2024 Spotify
 * API change, development-mode apps get `popularity`/`followers`/`genres` STRIPPED
 * from responses — so the old enrich-spotify only ever set photos, never rank.
 *
 * Deezer's public API returns `nb_fan` (fan count) per artist with no key. We
 * store it as `followers` and a log-scaled 0-100 `popularity` (Spotify-like) that
 * drives the Top-100 badge + the DB rank_score.
 *
 *   node scripts/enrich-deezer.mjs            # all artists
 *   node scripts/enrich-deezer.mjs --missing  # only those without a popularity
 *   node scripts/enrich-deezer.mjs "Turnstile" "IDLES"
 *
 * Writes src/seed/catalog.generated.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fan count → a 0-100 popularity (log scale): 1k fans ≈ 37, 100k ≈ 62, 12M ≈ 88.
const popFromFans = (n) => Math.max(1, Math.min(100, Math.round(Math.log10((n || 0) + 1) * 12.5)));

async function deezerArtist(name) {
  try {
    const r = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const d = await r.json();
    const items = d?.data || [];
    if (!items.length) return null;
    const lower = name.toLowerCase();
    return items.find((x) => (x.name || "").toLowerCase() === lower) || items[0];
  } catch { return null; }
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const missingOnly = process.argv.includes("--missing");
  const filter = process.argv.slice(2).filter((s) => !s.startsWith("--")).map((s) => s.toLowerCase());
  const keys = Object.keys(cat.artists || {}).filter((k) => {
    if (filter.length) return filter.includes(k) || filter.includes(cat.artists[k].name?.toLowerCase());
    if (missingOnly) return cat.artists[k].popularity == null;
    return true;
  });
  console.log(`Enriching ${keys.length} artist(s) from Deezer (fan counts + photos)…`);

  let matched = 0, done = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    const dz = await deezerArtist(a.name);
    await sleep(70); // gentle on the keyless API
    if (dz && typeof dz.nb_fan === "number") {
      a.followers = dz.nb_fan;
      a.popularity = popFromFans(dz.nb_fan);
      if (!a.photo && (dz.picture_xl || dz.picture_big)) { a.photo = dz.picture_xl || dz.picture_big; a.photoCredit = "Deezer"; }
      matched++;
    }
    if (++done % 25 === 0) { console.log(`  …${done}/${keys.length} (${matched} ranked)`); await writeFile(OUT, JSON.stringify(cat, null, 2)); }
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`\nDone. ${matched}/${keys.length} artists ranked by fan count.`);
}
main();
