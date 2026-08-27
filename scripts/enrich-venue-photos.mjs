#!/usr/bin/env node
/**
 * Fill venues that have NO (or thin) photos with properly-LICENSED images so the
 * venue hero stops falling back to the blank gradient card — and so the venue
 * gallery can self-heal when a fan photo is moderated out.
 *
 *   node scripts/enrich-venue-photos.mjs                 # only venues missing photos
 *   node scripts/enrich-venue-photos.mjs --all           # every venue
 *   node scripts/enrich-venue-photos.mjs "The Fillmore"  # just these
 *
 * Sources, in priority order (same chain as the artist enrichment):
 *   1. Wikimedia Commons geo-photos (ingest-venue-photos.mjs) — lead the pool
 *   2. **Openverse** — CC commercial+modifiable, creator/license/source stored
 * Unlicensed open-web fallback is intentionally excluded. A thin verified
 * gallery is safer than filling the venue with unverifiable inventory.
 *
 * Writes  venues[k].galleryPool : Array<{ uri, credit, source }>  and tops up
 * venues[k].photos / .photo.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";

const UA = "MshpitVenuePhotoBackfill/1.0 (https://mshpit.com; founder@mshpit.com)";
const OPENVERSE_TOKEN = String(process.env.OPENVERSE_API_TOKEN || "").trim();
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POOL_MAX = 10;
const PHOTOS_MAX = 6;

const getJSON = async (url, h = {}) => {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...h } });
  if (r.status === 429) throw new Error(`Openverse rate limited this offline run; retry after ${r.headers.get("retry-after") || "the provider window"}.`);
  if (!r.ok) throw new Error(`Openverse request failed with HTTP ${r.status}.`);
  return r.json();
};
const openverseLicense = (r) => {
  const token = `${r.license || ""}-${r.license_version || ""}`.toUpperCase();
  return ({ "BY-2.0": "CC-BY-2.0", "BY-SA-2.0": "CC-BY-SA-2.0",
    "BY-3.0": "CC-BY-3.0", "BY-SA-3.0": "CC-BY-SA-3.0",
    "BY-4.0": "CC-BY-4.0", "BY-SA-4.0": "CC-BY-SA-4.0" })[token] || null;
};

async function openverse(query) {
  if (!OPENVERSE_TOKEN) throw new Error("Set OPENVERSE_API_TOKEN before running licensed Openverse enrichment.");
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&license_type=commercial,modification&page_size=10&mature=false`;
  const d = await getJSON(url, { Authorization: `Bearer ${OPENVERSE_TOKEN}` });
  return (d?.results || [])
    .filter((r) => r.url && /\.(jpe?g|png)(\?|$)/i.test(r.url))
    .map((r) => ({
      uri: r.url, sourcePage: r.foreign_landing_url, creator: r.creator,
      license: openverseLicense(r), licenseUrl: r.license_url, source: "openverse",
    }))
    .map(licensedVenuePhoto).filter(Boolean);
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  // Curated app-side venues (arenas.js) first — otherwise they are invisible to
  // the photo pipeline and stay blank forever. See scripts/sync-anchors.mjs.
  const { syncAnchors } = await import("./sync-anchors.mjs");
  const synced = await syncAnchors(cat);
  if (synced) console.log(`Synced ${synced} curated venue(s) into the catalog.`);
  const venues = cat.venues || {};
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const names = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());

  const keys = Object.keys(venues).filter((k) => {
    const v = venues[k];
    if (names.length) return names.includes(k) || names.includes(v.name?.toLowerCase());
    if (all) return true;
    return !(v.photos && v.photos.length) && !v.photo; // default: only the blanks
  });
  console.log(`Filling ${keys.length} venue(s) via Openverse…`);

  let filled = 0, done = 0;
  for (const k of keys) {
    const v = venues[k];
    const city = (v.place || "").split(",")[0].trim();
    const commons = (v.galleryPool || []).map(licensedVenuePhoto).filter(Boolean)
      .filter((photo) => photo.provenanceSource === "commons");

    const building = await openverse(`"${v.name}"${city ? " " + city : ""}`);
    await sleep(700);
    const interior = await openverse(`"${v.name}" concert venue`);
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
    take([...commons, ...building, ...interior]);
    if (pool.length) {
      v.galleryPool = pool;
      v.photos = [...new Set([...(v.photos || []), ...pool.map((p) => p.uri)])].slice(0, PHOTOS_MAX);
      if (!v.photo) v.photo = pool[0].uri;
      if (!v.photoCredit) v.photoCredit = pool[0].by;
      filled++;
    }
    if (++done % 15 === 0) {
      console.log(`  …${done}/${keys.length} (${filled} filled)`);
      await writeFile(OUT, JSON.stringify(cat, null, 2));
    }
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${filled}/${keys.length} venues now carry photos.`);
}
main();
