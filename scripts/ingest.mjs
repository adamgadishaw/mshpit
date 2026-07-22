#!/usr/bin/env node
/**
 * Pit data ingestion — populate the catalog from LEGAL / open sources only.
 *
 *   node scripts/ingest.mjs "Turnstile" "IDLES" "Mitski"
 *
 * Sources (all either open-licensed or official APIs — no HTML scraping, which
 * violates most sites' ToS and grabs copyrighted media):
 *   - MusicBrainz   (CC0)            artist + venue identity, no key. Be polite:
 *                                    set a real User-Agent, ~1 request/second.
 *   - Wikidata/Commons (CC/PD)       venue + artist images via the P18 property,
 *                                    with author + license stored for attribution.
 *   - Setlist.fm    (API key)        recent setlists.            SETLISTFM_KEY
 *   - Ticketmaster Discovery (key)   upcoming dates + ticket URLs (affiliate).
 *                                                                TICKETMASTER_KEY
 *
 * Output: src/seed/catalog.generated.json  (merge into src/seed/catalog.js).
 *
 * What we DON'T do: copy concert photos off Google/Instagram/Ticketmaster.
 * Those are copyrighted by the photographer. Images come from Wikimedia Commons
 * (properly licensed) or official artist images via the music APIs.
 */

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (https://example.com; contact@example.com)";
const SETLISTFM_KEY = process.env.SETLISTFM_KEY;
const TICKETMASTER_KEY = process.env.TICKETMASTER_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// --- MusicBrainz: resolve an artist to its MBID + linked Wikidata id ----------
async function mbArtist(name) {
  const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=1`;
  const data = await getJSON(url);
  const a = data.artists?.[0];
  if (!a) return null;
  await sleep(1100); // MusicBrainz rate limit: ~1 req/sec
  const detail = await getJSON(`https://musicbrainz.org/ws/2/artist/${a.id}?inc=url-rels&fmt=json`);
  const wd = detail.relations?.find((r) => r.type === "wikidata")?.url?.resource;
  const wikidataId = wd ? wd.split("/").pop() : null;
  return { mbid: a.id, name: a.name, genre: a.tags?.sort((x, y) => y.count - x.count)?.[0]?.name || null, wikidataId };
}

// --- Wikidata P18 -> a real, licensed Wikimedia Commons image -----------------
async function wikidataImage(wikidataId) {
  if (!wikidataId) return null;
  const data = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`);
  const entity = data.entities?.[wikidataId];
  const file = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!file) return null;
  // Commons "Special:FilePath" resolves to the actual image bytes.
  const photo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1024`;
  // pull license + author for attribution (required by CC-BY/SA)
  let photoCredit = "Wikimedia Commons";
  try {
    const meta = await getJSON(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(file)}&prop=imageinfo&iiprop=extmetadata&format=json`
    );
    const page = Object.values(meta.query?.pages || {})[0];
    const m = page?.imageinfo?.[0]?.extmetadata;
    const author = (m?.Artist?.value || "").replace(/<[^>]+>/g, "").trim();
    const license = m?.LicenseShortName?.value || "";
    photoCredit = [author, license].filter(Boolean).join(" · ") || photoCredit;
  } catch {}
  return { photo, photoCredit };
}

// --- Setlist.fm: most recent setlist for an artist ----------------------------
async function recentSetlist(mbid) {
  if (!SETLISTFM_KEY || !mbid) return null;
  try {
    const data = await getJSON(`https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?p=1`, { "x-api-key": SETLISTFM_KEY });
    const set = data.setlist?.[0];
    if (!set) return null;
    const songs = (set.sets?.set || []).flatMap((s) => (s.song || []).map((x) => x.name)).filter(Boolean);
    return { venue: set.venue?.name, city: set.venue?.city?.name, songs };
  } catch {
    return null;
  }
}

// --- Ticketmaster Discovery: upcoming dates + ticket links --------------------
async function upcomingDates(name) {
  if (!TICKETMASTER_KEY) return [];
  try {
    const data = await getJSON(
      `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(name)}&classificationName=music&size=5&sort=date,asc&apikey=${TICKETMASTER_KEY}`
    );
    return (data._embedded?.events || []).map((e) => {
      const v = e._embedded?.venues?.[0];
      const d = e.dates?.start?.localDate;
      return {
        artist: name,
        venue: v?.name,
        place: [v?.city?.name, v?.state?.name, v?.country?.name].filter(Boolean).join(", "),
        lat: v?.location?.latitude ? Number(v.location.latitude) : null,
        lng: v?.location?.longitude ? Number(v.location.longitude) : null,
        date: d,
        ticketUrl: e.url, // official + affiliate-ready
        soldOut: e.dates?.status?.code === "offsale", // TM marks sold-out as offsale
      };
    });
  } catch {
    return [];
  }
}

async function main() {
  const names = process.argv.slice(2);
  if (!names.length) {
    console.error('Usage: node scripts/ingest.mjs "Artist One" "Artist Two" ...');
    process.exit(1);
  }
  console.log(`Ingesting ${names.length} artist(s) from open sources…`);
  if (!SETLISTFM_KEY) console.log("  (no SETLISTFM_KEY — skipping setlists)");
  if (!TICKETMASTER_KEY) console.log("  (no TICKETMASTER_KEY — skipping tour dates)");

  const artists = {};
  const venues = {};
  const tourDates = [];
  const shows = [];

  for (const name of names) {
    try {
      const a = await mbArtist(name);
      if (!a) { console.warn(`  ! no match: ${name}`); continue; }
      await sleep(1100);
      const img = await wikidataImage(a.wikidataId);
      artists[a.name.toLowerCase()] = { name: a.name, mbid: a.mbid, genre: a.genre, photo: img?.photo || null, photoCredit: img?.photoCredit || null };

      const set = await recentSetlist(a.mbid);
      if (set?.venue) {
        venues[set.venue.toLowerCase()] = { name: set.venue, place: set.city || null, photo: null, photoCredit: null };
        shows.push({ artist: a.name, genre: a.genre, venue: set.venue, city: set.city, setlist: set.songs.slice(0, 12) });
      }

      for (const d of await upcomingDates(name)) {
        if (d.venue) {
          venues[d.venue.toLowerCase()] = venues[d.venue.toLowerCase()] || { name: d.venue, place: d.place, photo: null, photoCredit: null };
          tourDates.push({ ...d, releaseAt: Date.now(), createdBy: "import" });
        }
      }
      console.log(`  ✓ ${a.name}${img ? " (+image)" : ""}${set ? " (+setlist)" : ""}`);
    } catch (e) {
      console.warn(`  ! ${name}: ${e.message}`);
    }
    await sleep(1100);
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
  // Preserve venues/shows/tourDates from the venue scrape; only refresh artists.
  let prev = { artists: {}, venues: {}, shows: [], tourDates: [] };
  try { prev = JSON.parse(await readFile(out, "utf8")); } catch {}
  const merged = {
    artists: { ...prev.artists, ...artists },
    venues: Object.keys(venues).length ? { ...prev.venues, ...venues } : prev.venues,
    shows: shows.length ? [...prev.shows, ...shows] : prev.shows,
    tourDates: tourDates.length ? [...prev.tourDates, ...tourDates] : prev.tourDates,
    ingestedAt: new Date().toISOString(),
  };
  await writeFile(out, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${out}`);
  console.log(`  ${Object.keys(merged.artists).length} artists · ${Object.keys(merged.venues).length} venues (preserved)`);
}

main();
