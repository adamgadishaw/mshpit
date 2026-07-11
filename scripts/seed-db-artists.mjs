#!/usr/bin/env node
/**
 * Seed the DB artist catalog toward ~10k artists across ALL genres, keyless.
 * DB-BACKED (not the bundle): writes straight into the `artists` table, so it
 * scales without bloating the web bundle. On-demand resolve + the Deezer
 * discography endpoint fill songs/albums when a page is opened, so every seeded
 * artist is playable without pre-baking tracks.
 *
 * Two phases, both idempotent + resumable (safe to re-run; WAL means it can run
 * while the web service is live):
 *   1. CRAWL  — MusicBrainz tag search (CC0, ~1 req/s) → upsert name/genre/mbid/
 *               country/formed until the target is hit or the tags run out.
 *   2. ENRICH — for artists still missing popularity, Deezer (keyless) fills fan
 *               count → 0-100 popularity, a photo, and the rank_score that orders
 *               search "notable first". Skips anyone already ranked, so a killed
 *               run just continues.
 *
 * Run against the SAME DB the server uses:
 *   local:   node scripts/seed-db-artists.mjs --target 10000
 *   Render:  (one-off shell on the web service)
 *            PIT_DATA_DIR=/data node scripts/seed-db-artists.mjs --target 10000
 *
 * Flags: --target N (default 10000) · --no-enrich (crawl only, fast) ·
 *        --enrich-only (skip the crawl, just rank thin rows) · --per-tag N (crawl
 *        depth per genre, default 600).
 */
import { artistStmts, artistRow, normName, db } from "../server/db.js";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const TARGET = Number(flag("--target", 10000)) || 10000;
const PER_TAG = Number(flag("--per-tag", 600)) || 600;
const NO_ENRICH = args.includes("--no-enrich");
const ENRICH_ONLY = args.includes("--enrich-only");
const PAGE = 100; // MusicBrainz hard max per request
const UA = "PitConcertApp/1.0 (https://mshpit.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const popFromFans = (n) => Math.max(1, Math.min(100, Math.round(Math.log10((n || 0) + 1) * 12.5)));

// Broad genre coverage: each tag pulls real artists from MusicBrainz keyless.
const TAGS = [
  ["punk", "Punk"], ["pop punk", "Pop Punk"], ["hardcore", "Hardcore"], ["hardcore punk", "Hardcore"],
  ["metalcore", "Metalcore"], ["indie rock", "Indie"], ["indie pop", "Indie"], ["shoegaze", "Shoegaze"],
  ["dream pop", "Dream Pop"], ["metal", "Metal"], ["death metal", "Metal"], ["black metal", "Metal"],
  ["doom metal", "Metal"], ["thrash metal", "Metal"], ["nu metal", "Metal"], ["alternative metal", "Metal"],
  ["progressive metal", "Metal"], ["electronic", "Electronic"], ["techno", "Techno"], ["house", "House"],
  ["deep house", "House"], ["drum and bass", "DnB"], ["dubstep", "Dubstep"], ["trance", "Trance"],
  ["edm", "EDM"], ["ambient", "Ambient"], ["idm", "Electronic"], ["hip hop", "Hip-Hop"], ["rap", "Hip-Hop"],
  ["trap", "Trap"], ["grime", "Grime"], ["r&b", "R&B"], ["contemporary r&b", "R&B"], ["soul", "Soul"],
  ["funk", "Funk"], ["disco", "Disco"], ["jazz", "Jazz"], ["bossa nova", "Jazz"], ["blues", "Blues"],
  ["pop", "Pop"], ["synthpop", "Synthpop"], ["new wave", "New Wave"], ["k-pop", "K-Pop"], ["j-pop", "J-Pop"],
  ["rock", "Rock"], ["classic rock", "Rock"], ["hard rock", "Rock"], ["garage rock", "Garage Rock"],
  ["grunge", "Grunge"], ["progressive rock", "Prog Rock"], ["psychedelic rock", "Psych Rock"],
  ["post-rock", "Post-Rock"], ["math rock", "Math Rock"], ["noise rock", "Noise Rock"], ["emo", "Emo"],
  ["post-punk", "Post-Punk"], ["dance-punk", "Dance-Punk"], ["alternative rock", "Alt Rock"],
  ["experimental", "Experimental"], ["folk", "Folk"], ["indie folk", "Folk"], ["americana", "Americana"],
  ["country", "Country"], ["bluegrass", "Bluegrass"], ["singer-songwriter", "Singer-Songwriter"],
  ["reggae", "Reggae"], ["dancehall", "Dancehall"], ["ska", "Ska"], ["afrobeat", "Afrobeat"],
  ["afrobeats", "Afrobeats"], ["latin", "Latin"], ["reggaeton", "Reggaeton"], ["salsa", "Latin"],
  ["classical", "Classical"], ["gospel", "Gospel"], ["world", "World"],
];

async function mbTag(tag, offset) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`tag:"${tag}"`)}&fmt=json&limit=${PAGE}&offset=${offset}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.artists || [])
      .filter((x) => x.name && (x.type === "Group" || x.type === "Person"))
      .map((x) => ({ name: x.name, mbid: x.id, beginYear: x["life-span"]?.begin?.slice(0, 4) || null, country: x.area?.name || null }));
  } catch { return []; }
}

async function deezer(name) {
  try {
    const r = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const items = (await r.json())?.data || [];
    const lower = name.toLowerCase();
    return items.find((x) => (x.name || "").toLowerCase() === lower) || items[0] || null;
  } catch { return null; }
}

async function crawl() {
  const start = artistStmts.count.get().c;
  console.log(`Crawl: ${TAGS.length} genres, up to ${PER_TAG} deep each → target ${TARGET} (DB has ${start}).`);
  let added = 0;
  outer: for (const [tag, genre] of TAGS) {
    let tagAdded = 0;
    for (let offset = 0; offset < PER_TAG; offset += PAGE) {
      if (artistStmts.count.get().c >= TARGET) break outer;
      const list = await mbTag(tag, offset);
      await sleep(1100); // MusicBrainz ~1 req/s
      for (const x of list) {
        const norm = normName(x.name);
        if (artistStmts.byNorm.get(norm)) continue; // additive: never clobber
        artistStmts.upsert.run(artistRow(norm, { name: x.name, genre, mbid: x.mbid, country: x.country, beginYear: x.beginYear }, "musicbrainz"));
        added++; tagAdded++;
      }
      if (list.length < PAGE) break; // tag exhausted
    }
    console.log(`  ✓ ${tag}: +${tagAdded}  (DB ${artistStmts.count.get().c})`);
  }
  console.log(`Crawl done: +${added} artists (DB now ${artistStmts.count.get().c}).`);
}

async function enrich() {
  const thin = db.prepare("SELECT norm, name, genre, mbid, country, formed, data FROM artists WHERE popularity IS NULL");
  const rows = thin.all();
  console.log(`Enrich: ${rows.length} artist(s) missing popularity → Deezer fan counts + photos.`);
  let ranked = 0, done = 0;
  for (const row of rows) {
    const dz = await deezer(row.name);
    await sleep(80); // gentle on the keyless API
    if (dz && typeof dz.nb_fan === "number") {
      let data = {}; try { data = JSON.parse(row.data || "{}"); } catch {}
      const pop = popFromFans(dz.nb_fan);
      const photo = dz.picture_xl || dz.picture_big || null;
      const merged = { ...data, name: row.name, genre: row.genre, mbid: row.mbid, country: row.country, beginYear: row.formed, popularity: pop, followers: dz.nb_fan, photo: data.photo || photo, photoCredit: data.photo ? data.photoCredit : (photo ? "Deezer" : null) };
      artistStmts.upsert.run(artistRow(row.norm, merged, "deezer"));
      ranked++;
    }
    if (++done % 50 === 0) console.log(`  …${done}/${rows.length} (${ranked} ranked)`);
  }
  console.log(`Enrich done: ${ranked}/${rows.length} ranked by fan count.`);
}

(async () => {
  const t0 = Date.now();
  if (!ENRICH_ONLY) await crawl();
  if (!NO_ENRICH) await enrich();
  console.log(`\nAll done in ${Math.round((Date.now() - t0) / 1000)}s. DB total: ${artistStmts.count.get().c} artists.`);
})();
