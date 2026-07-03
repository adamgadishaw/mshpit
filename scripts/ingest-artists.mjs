#!/usr/bin/env node
/**
 * Roster expansion — grow the artist catalog Soundmap-style: hundreds of real
 * artists across genres, whether or not they have upcoming dates (a fan club
 * doesn't need a tour). Pulls from MusicBrainz tag search (CC0, keyless) and
 * keeps the artist's life-span, so bands that broke up get an honest
 * status: "dissolved" (+ endYear) instead of pretending they're active.
 *
 * ADDITIVE: never overwrites an existing artist. After running, top up media:
 *   node --env-file=.env scripts/enrich-spotify.mjs      # official photos
 *   node scripts/enrich-album-art.mjs                    # albums + covers
 *   node --env-file=.env scripts/enrich-toptracks.mjs    # real songs
 *
 *   node scripts/ingest-artists.mjs            # default tags, top 30 per tag
 *   PER_TAG=50 node scripts/ingest-artists.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PER_TAG = Number(process.env.PER_TAG) || 30;

// Tag → app genre label. Tags chosen to match the app's existing genre set.
const TAGS = [
  ["punk", "Punk"],
  ["hardcore", "Hardcore"],
  ["indie rock", "Indie"],
  ["indie pop", "Indie"],
  ["shoegaze", "Shoegaze"],
  ["metal", "Metal"],
  ["electronic", "Electronic"],
  ["hip hop", "Hip-Hop"],
  ["pop", "Pop"],
  ["rock", "Rock"],
  ["folk", "Folk"],
  ["alternative rock", "Alt Rock"],
  ["psychedelic rock", "Psych Rock"],
  ["emo", "Emo"],
  ["post-punk", "Post-Punk"],
];

async function artistsForTag(tag) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`tag:"${tag}"`)}&fmt=json&limit=${Math.min(PER_TAG, 100)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.artists || [])
      .filter((x) => x.name && (x.type === "Group" || x.type === "Person"))
      .map((x) => ({
        name: x.name,
        mbid: x.id,
        type: x.type,
        beginYear: x["life-span"]?.begin?.slice(0, 4) || null,
        endYear: x["life-span"]?.end?.slice(0, 4) || null,
        ended: !!x["life-span"]?.ended,
        country: x.area?.name || null,
      }));
  } catch (e) {
    console.warn(`  ! tag ${tag}: ${e.message}`);
    return [];
  }
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  cat.artists ||= {};
  const before = Object.keys(cat.artists).length;

  console.log(`Expanding roster: ${TAGS.length} tags × up to ${PER_TAG} artists…`);
  let added = 0, dissolved = 0;
  for (const [tag, genre] of TAGS) {
    const list = await artistsForTag(tag);
    let tagAdded = 0;
    for (const x of list) {
      const k = x.name.toLowerCase();
      if (cat.artists[k]) continue; // additive only
      cat.artists[k] = {
        name: x.name,
        genre,
        mbid: x.mbid,
        photo: null,
        photoCredit: null,
        status: x.ended ? "dissolved" : "active",
        beginYear: x.beginYear,
        endYear: x.endYear,
        country: x.country,
      };
      added++; tagAdded++;
      if (x.ended) dissolved++;
    }
    console.log(`  ✓ ${tag}: +${tagAdded}`);
    await sleep(1100); // MusicBrainz rate limit
  }

  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`\nDone (additive). ${before} -> ${Object.keys(cat.artists).length} artists (+${added}, ${dissolved} marked dissolved).`);
  console.log("Now run: enrich-spotify, enrich-album-art, enrich-toptracks.");
}
main();
