#!/usr/bin/env node
/**
 * Deepen each artist's photo gallery with properly-LICENSED images so empty or
 * thin galleries get filled with real portraits + live/tour shots — and so the
 * app's self-healing 5-pick gallery has a backfill pool when a fan photo is
 * moderated out.
 *
 *   node scripts/enrich-photos.mjs                 # all artists in the catalog
 *   node scripts/enrich-photos.mjs "Turnstile" "IDLES"   # just these
 *
 * Sources, in priority order:
 *   1. Wikimedia Commons photos already on the artist (lead the pool, attributed)
 *   2. **Openverse** (https://openverse.org) — Creative Commons' image API,
 *      commercial+modifiable licenses only, creator/license/source stored.
 *   3. **Open web** (source:"google"/"web") — final tier, only when 1+2 can't
 *      fill the pool. NOT license-cleared: used under a takedown-on-request policy
 *      (see DATA_SOURCES.md / store `removePhoto`). Google Programmable Search
 *      (GOOGLE_CSE_KEY + GOOGLE_CSE_CX) when keyed; Bing Images keyless otherwise.
 *
 * Writes  artists[k].galleryPool : Array<{ uri, credit, source }>  (ordered
 * backfill pool) and tops up artists[k].photos (string[]) for the PHOTOS strip.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webImages } from "./lib/web-images.mjs";

const UA = "PitConcertApp/0.1 (https://example.com; contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POOL_MAX = 14; // deep enough to refill a 5-pick gallery several times over
const PHOTOS_MAX = 8;

const getJSON = async (url, h = {}) => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...h } });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
};

const credit = (r) =>
  [r.creator, [r.license, r.license_version].filter(Boolean).join(" ").toUpperCase(), r.source && `(${r.source})`]
    .filter(Boolean)
    .join(" · ");

// One Openverse query -> normalized, licensed image rows.
async function openverse(query) {
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&license_type=commercial,modification&page_size=12&mature=false`;
  const d = await getJSON(url);
  return (d?.results || [])
    .filter((r) => r.url && /\.(jpe?g|png)(\?|$)/i.test(r.url))
    .map((r) => ({ uri: r.url, credit: credit(r), source: "openverse" }));
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const filter = process.argv.slice(2).map((s) => s.toLowerCase());
  const keys = Object.keys(cat.artists || {}).filter((k) => !filter.length || filter.includes(k) || filter.includes(cat.artists[k].name?.toLowerCase()));
  console.log(`Deepening galleries for ${keys.length} artist(s) via Openverse…`);

  let filled = 0, done = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    // Commons photos lead the pool (preferred, already attributed as Commons).
    const commons = (a.photos || []).map((uri) => ({ uri, credit: a.photoCredit || "Wikimedia Commons", source: "commons" }));

    // Portraits + live/tour shots from Openverse.
    const portraits = await openverse(`"${a.name}" band`);
    await sleep(700);
    const live = await openverse(`"${a.name}" concert live`);
    await sleep(700);

    const seen = new Set();
    const pool = [];
    const take = (rows) => {
      for (const row of rows) {
        if (!row.uri || seen.has(row.uri)) continue;
        seen.add(row.uri);
        pool.push(row);
        if (pool.length >= POOL_MAX) return;
      }
    };
    take([...commons, ...portraits, ...live]);
    // Final tier: top up whatever the licensed sources couldn't fill with open-web
    // images (takedown-on-request). Only pay the request when still short.
    if (pool.length < POOL_MAX) {
      const g = await webImages(`${a.name} band live concert portrait`, POOL_MAX);
      await sleep(500);
      take(g);
    }

    if (pool.length) {
      a.galleryPool = pool;
      // Top up the flat PHOTOS strip too (Commons first, already there).
      a.photos = [...new Set([...(a.photos || []), ...pool.map((p) => p.uri)])].slice(0, PHOTOS_MAX);
      if (!a.photo) a.photo = pool[0].uri;
      filled++;
    }
    if (++done % 10 === 0) {
      console.log(`  …${done}/${keys.length} (${filled} filled)`);
      await writeFile(OUT, JSON.stringify(cat, null, 2));
    }
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${filled}/${keys.length} artists now carry a backfill gallery pool.`);
}
main();
