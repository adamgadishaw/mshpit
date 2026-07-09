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
// PER_TAG is now the DEEP-CRAWL DEPTH per tag (fetched 100 at a time via offset
// pagination), not a single-page cap — so the roster can climb well past the old
// ~2.5k plateau toward ARTIST_TARGET. Stop the whole crawl once the target is hit.
const PER_TAG = Number(process.env.PER_TAG) || 400;
const TARGET = Number(process.env.ARTIST_TARGET) || Infinity;
const PAGE = 100; // MusicBrainz hard max per request

// Tag → app genre label. Tags chosen to match the app's existing genre set.
// Broad + deep on purpose — every tag pulls up to 100 real artists from
// MusicBrainz (keyless), so more tags = a bigger, more varied roster.
const TAGS = [
  ["punk", "Punk"],
  ["pop punk", "Pop Punk"],
  ["hardcore", "Hardcore"],
  ["metalcore", "Metalcore"],
  ["indie rock", "Indie"],
  ["indie pop", "Indie"],
  ["shoegaze", "Shoegaze"],
  ["dream pop", "Dream Pop"],
  ["metal", "Metal"],
  ["death metal", "Metal"],
  ["black metal", "Metal"],
  ["doom metal", "Metal"],
  ["electronic", "Electronic"],
  ["techno", "Techno"],
  ["house", "House"],
  ["drum and bass", "DnB"],
  ["ambient", "Ambient"],
  ["hip hop", "Hip-Hop"],
  ["rap", "Hip-Hop"],
  ["grime", "Grime"],
  ["r&b", "R&B"],
  ["soul", "Soul"],
  ["funk", "Funk"],
  ["jazz", "Jazz"],
  ["pop", "Pop"],
  ["synthpop", "Synthpop"],
  ["new wave", "New Wave"],
  ["k-pop", "K-Pop"],
  ["rock", "Rock"],
  ["classic rock", "Rock"],
  ["garage rock", "Garage Rock"],
  ["grunge", "Grunge"],
  ["folk", "Folk"],
  ["americana", "Americana"],
  ["country", "Country"],
  ["blues", "Blues"],
  ["reggae", "Reggae"],
  ["ska", "Ska"],
  ["afrobeat", "Afrobeat"],
  ["latin", "Latin"],
  ["alternative rock", "Alt Rock"],
  ["psychedelic rock", "Psych Rock"],
  ["post-rock", "Post-Rock"],
  ["math rock", "Math Rock"],
  ["noise rock", "Noise Rock"],
  ["emo", "Emo"],
  ["post-punk", "Post-Punk"],
  ["dance-punk", "Dance-Punk"],
  ["experimental", "Experimental"],
  ["singer-songwriter", "Singer-Songwriter"],
];

async function artistsForTag(tag, offset = 0) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`tag:"${tag}"`)}&fmt=json&limit=${PAGE}&offset=${offset}`;
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

  const targetLabel = TARGET === Infinity ? "∞" : TARGET;
  console.log(`Expanding roster: ${TAGS.length} tags, up to ${PER_TAG} deep each → target ${targetLabel} artists…`);
  let added = 0, dissolved = 0;
  outer: for (const [tag, genre] of TAGS) {
    let tagAdded = 0;
    // Deep-crawl this tag one 100-page at a time until we hit the depth cap, run
    // out of results (last page < PAGE), or the global target is reached.
    for (let offset = 0; offset < PER_TAG; offset += PAGE) {
      if (Object.keys(cat.artists).length >= TARGET) break outer;
      const list = await artistsForTag(tag, offset);
      await sleep(1100); // MusicBrainz rate limit (~1 req/s)
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
      if (list.length < PAGE) break; // exhausted this tag's results
    }
    console.log(`  ✓ ${tag}: +${tagAdded} (roster ${Object.keys(cat.artists).length})`);
    await writeFile(OUT, JSON.stringify(cat, null, 2)); // save per tag so progress survives a kill
  }

  console.log(`\nDone (additive). ${before} -> ${Object.keys(cat.artists).length} artists (+${added}, ${dissolved} marked dissolved).`);
  console.log("Now run: enrich-spotify, enrich-album-art, enrich-toptracks.");
}
main();
