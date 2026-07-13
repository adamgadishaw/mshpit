#!/usr/bin/env node
/**
 * Canada booster — make the catalog as deep for Canadians as for Americans.
 *
 * ADDITIVE and idempotent: it merges new Canadian venues from MusicBrainz (CC0),
 * seeds a roster of real Canadian touring artists. It never invents performances
 * or ratings; those must come from a provider with a stable event id. It never overwrites
 * an existing venue (so the photo galleryPools stay intact). Re-running removes
 * legacy generated `ca_` event rows and refreshes venue/artist facts only.
 *
 *   node scripts/ingest-canada.mjs
 *
 * Run the photo enrichment afterwards to fill the new artists/venues:
 *   node scripts/enrich-photos.mjs <new artists…>
 *   node scripts/enrich-venue-photos.mjs        # fills any new blank venues
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "mshpit/1.0 (https://www.mshpit.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");

const km = (a, b) => {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// city, MusicBrainz area query, province, coords. Distance-filtered to the city
// center, so MB name clashes (e.g. London ON vs London UK) get dropped.
const CITIES = [
  ["Toronto", "Toronto", "Ontario", 43.6532, -79.3832],
  ["Mississauga", "Mississauga", "Ontario", 43.589, -79.6441],
  ["Hamilton", "Hamilton", "Ontario", 43.2557, -79.8711],
  ["Ottawa", "Ottawa", "Ontario", 45.4215, -75.6972],
  ["Kitchener", "Kitchener", "Ontario", 43.4516, -80.4925],
  ["Guelph", "Guelph", "Ontario", 43.5448, -80.2482],
  ["London", "London", "Ontario", 42.9849, -81.2453],
  ["Kingston", "Kingston", "Ontario", 44.2312, -76.486],
  ["Windsor", "Windsor", "Ontario", 42.3149, -83.0364],
  ["Sudbury", "Sudbury", "Ontario", 46.4917, -80.993],
  ["Thunder Bay", "Thunder Bay", "Ontario", 48.3809, -89.2477],
  ["Montreal", "Montreal", "Quebec", 45.5019, -73.5674],
  ["Laval", "Laval", "Quebec", 45.6066, -73.7124],
  ["Quebec City", "Quebec City", "Quebec", 46.8139, -71.208],
  ["Gatineau", "Gatineau", "Quebec", 45.4765, -75.7013],
  ["Sherbrooke", "Sherbrooke", "Quebec", 45.4042, -71.8929],
  ["Vancouver", "Vancouver", "British Columbia", 49.2827, -123.1207],
  ["Victoria", "Victoria", "British Columbia", 48.4284, -123.3656],
  ["Kelowna", "Kelowna", "British Columbia", 49.888, -119.496],
  ["Calgary", "Calgary", "Alberta", 51.0447, -114.0719],
  ["Edmonton", "Edmonton", "Alberta", 53.5461, -113.4938],
  ["Winnipeg", "Winnipeg", "Manitoba", 49.8951, -97.1384],
  ["Saskatoon", "Saskatoon", "Saskatchewan", 52.1332, -106.67],
  ["Regina", "Regina", "Saskatchewan", 50.4452, -104.6189],
  ["Halifax", "Halifax", "Nova Scotia", 44.6488, -63.5752],
  ["Moncton", "Moncton", "New Brunswick", 46.0878, -64.7782],
  ["St. John's", "St. John's", "Newfoundland and Labrador", 47.5615, -52.7126],
  ["Charlottetown", "Charlottetown", "Prince Edward Island", 46.2382, -63.1311],
];

// Real Canadian touring acts, spread across the genres the app already uses.
const ARTISTS = [
  ["Arcade Fire", "Indie"], ["Broken Social Scene", "Indie"], ["Alvvays", "Indie"],
  ["Metric", "Indie"], ["Men I Trust", "Indie"], ["The New Pornographers", "Indie"],
  ["Destroyer", "Indie"], ["Stars", "Indie"], ["TOPS", "Indie"], ["Wolf Parade", "Indie"],
  ["The Weather Station", "Indie"], ["Feist", "Indie"], ["Andy Shauf", "Alt-Country"],
  ["PUP", "Punk"], ["Japandroids", "Punk"], ["Billy Talent", "Punk"],
  ["Fucked Up", "Hardcore"], ["Cancer Bats", "Hardcore"], ["Comeback Kid", "Hardcore"],
  ["Protest the Hero", "Metal"], ["Caribou", "Electronic"], ["Kaytranada", "Electronic"],
  ["Purity Ring", "Electronic"], ["Charlotte Cardin", "Pop"],
];

// Include arenas/stadiums/amphitheatres, not just "Venue" (MusicBrainz files the
// big rooms under those types), and keep the biggest first so they survive the slice.
const PLACE_TYPES = `(type:Venue OR type:Stadium OR type:"Indoor arena" OR type:Amphitheatre)`;
const TYPE_RANK = { Stadium: 0, "Indoor arena": 1, Amphitheatre: 2, Venue: 3 };

async function venuesForCity(c) {
  const [city, area, region, lat, lng] = c;
  const url = `https://musicbrainz.org/ws/2/place?query=${encodeURIComponent(`${PLACE_TYPES} AND area:"${area}"`)}&fmt=json&limit=40`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const data = await res.json();
    const center = { lat, lng };
    return (data.places || [])
      .filter((p) => p.coordinates && p.name)
      .map((p) => ({ name: p.name, type: p.type, lat: +p.coordinates.latitude, lng: +p.coordinates.longitude, place: `${city}, ${region}, Canada` }))
      .filter((v) => km(center, v) <= 60)
      .sort((a, b) => (TYPE_RANK[a.type] ?? 4) - (TYPE_RANK[b.type] ?? 4))
      .slice(0, 16);
  } catch (e) {
    console.warn(`  ! ${city}: ${e.message}`);
    return [];
  }
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  cat.artists ||= {};
  cat.venues ||= {};
  cat.shows ||= [];
  cat.tourDates ||= [];

  // Wipe only our own prior rows so a re-run refreshes cleanly (idempotent).
  cat.shows = cat.shows.filter((s) => !String(s.id).startsWith("ca_s_"));
  cat.tourDates = cat.tourDates.filter((t) => !String(t.id).startsWith("ca_t_"));

  // Seed Canadian artists (additive — keep any already present, incl. their photos).
  let newArtists = 0;
  for (const [name, genre] of ARTISTS) {
    const k = name.toLowerCase();
    if (!cat.artists[k]) { cat.artists[k] = { name, genre, photo: null, photoCredit: null }; newArtists++; }
  }

  console.log(`Scraping Canadian venues for ${CITIES.length} cities from MusicBrainz…`);
  let newVenues = 0;
  for (const c of CITIES) {
    const list = await venuesForCity(c);
    for (const v of list) {
      const key = v.name.trim().toLowerCase();
      if (!cat.venues[key]) {
        // brand-new venue: add it (photos get filled later by enrich-venue-photos)
        cat.venues[key] = { name: v.name, place: v.place, lat: v.lat, lng: v.lng, capacity: null, photo: null, photoCredit: null };
        newVenues++;
      }
    }
    console.log(`  ✓ ${c[0]}: ${list.length} venues`);
    await sleep(1100); // MusicBrainz rate limit
  }

  cat.ingestedAt = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  const caTd = cat.tourDates.filter((t) => String(t.id).startsWith("ca_t_")).length;
  const caShows = cat.shows.filter((s) => String(s.id).startsWith("ca_s_")).length;
  console.log(`\nDone (additive). +${newVenues} new venues · +${newArtists} new artists · ${caTd} CA upcoming dates · ${caShows} CA shows.`);
}
main();
