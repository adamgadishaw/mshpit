#!/usr/bin/env node
/**
 * Active venue scraper — pulls REAL venues (with real coordinates) for every
 * major US + Canada city from MusicBrainz (CC0, keyless). This job imports venue
 * facts only. Performances must come from a provider that supplies a real event
 * id (Ticketmaster/Bandsintown), never from generated artist pairings. Artists
 * and provider-backed tour dates already in the catalog are preserved.
 *
 *   node scripts/ingest-venues.mjs
 *
 * Writes src/seed/catalog.generated.json, which src/seed/catalog.js merges in.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "mshpit/1.0 (https://www.mshpit.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "seed", "catalog.generated.json");

const km = (a, b) => {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// city, MusicBrainz area query, region, country, coords
const CITIES = [
  ["New York City", "New York", "New York", "United States", 40.7128, -74.006],
  ["Brooklyn", "Brooklyn", "New York", "United States", 40.6782, -73.9442],
  ["Los Angeles", "Los Angeles", "California", "United States", 34.0522, -118.2437],
  ["San Francisco", "San Francisco", "California", "United States", 37.7749, -122.4194],
  ["Oakland", "Oakland", "California", "United States", 37.8044, -122.2712],
  ["San Diego", "San Diego", "California", "United States", 32.7157, -117.1611],
  ["Sacramento", "Sacramento", "California", "United States", 38.5816, -121.4944],
  ["San Jose", "San Jose", "California", "United States", 37.3382, -121.8863],
  ["Chicago", "Chicago", "Illinois", "United States", 41.8781, -87.6298],
  ["Austin", "Austin", "Texas", "United States", 30.2672, -97.7431],
  ["Dallas", "Dallas", "Texas", "United States", 32.7767, -96.797],
  ["Houston", "Houston", "Texas", "United States", 29.7604, -95.3698],
  ["Seattle", "Seattle", "Washington", "United States", 47.6062, -122.3321],
  ["Portland", "Portland", "Oregon", "United States", 45.5152, -122.6784],
  ["Denver", "Denver", "Colorado", "United States", 39.7392, -104.9903],
  ["Atlanta", "Atlanta", "Georgia", "United States", 33.749, -84.388],
  ["Boston", "Boston", "Massachusetts", "United States", 42.3601, -71.0589],
  ["Nashville", "Nashville", "Tennessee", "United States", 36.1627, -86.7816],
  ["Memphis", "Memphis", "Tennessee", "United States", 35.1495, -90.049],
  ["Washington", "Washington", "District of Columbia", "United States", 38.9072, -77.0369],
  ["Minneapolis", "Minneapolis", "Minnesota", "United States", 44.9778, -93.265],
  ["Philadelphia", "Philadelphia", "Pennsylvania", "United States", 39.9526, -75.1652],
  ["Detroit", "Detroit", "Michigan", "United States", 42.3314, -83.0458],
  ["Phoenix", "Phoenix", "Arizona", "United States", 33.4484, -112.074],
  ["Las Vegas", "Las Vegas", "Nevada", "United States", 36.1699, -115.1398],
  ["Miami", "Miami", "Florida", "United States", 25.7617, -80.1918],
  ["Orlando", "Orlando", "Florida", "United States", 28.5383, -81.3792],
  ["New Orleans", "New Orleans", "Louisiana", "United States", 29.9511, -90.0715],
  ["St. Louis", "Saint Louis", "Missouri", "United States", 38.627, -90.1994],
  ["Salt Lake City", "Salt Lake City", "Utah", "United States", 40.7608, -111.891],
  ["Pittsburgh", "Pittsburgh", "Pennsylvania", "United States", 40.4406, -79.9959],
  ["Cleveland", "Cleveland", "Ohio", "United States", 41.4993, -81.6944],
  ["Columbus", "Columbus", "Ohio", "United States", 39.9612, -82.9988],
  ["Charlotte", "Charlotte", "North Carolina", "United States", 35.2271, -80.8431],
  ["Milwaukee", "Milwaukee", "Wisconsin", "United States", 43.0389, -87.9065],
  ["Toronto", "Toronto", "Ontario", "Canada", 43.6532, -79.3832],
  ["Montreal", "Montreal", "Quebec", "Canada", 45.5019, -73.5674],
  ["Vancouver", "Vancouver", "British Columbia", "Canada", 49.2827, -123.1207],
  ["Calgary", "Calgary", "Alberta", "Canada", 51.0447, -114.0719],
  ["Edmonton", "Edmonton", "Alberta", "Canada", 53.5461, -113.4938],
  ["Ottawa", "Ottawa", "Ontario", "Canada", 45.4215, -75.6972],
  ["Winnipeg", "Winnipeg", "Manitoba", "Canada", 49.8951, -97.1384],
  ["Quebec City", "Quebec City", "Quebec", "Canada", 46.8139, -71.208],
  ["Victoria", "Victoria", "British Columbia", "Canada", 48.4284, -123.3656],
];

// Include Stadiums + Indoor arenas + Amphitheatres, not just "Venue" — the big
// rooms artists headline are filed under those types in MusicBrainz.
const PLACE_TYPES = `(type:Venue OR type:Stadium OR type:"Indoor arena" OR type:Amphitheatre)`;
// Arenas/stadiums first so they're never sliced off the end.
const TYPE_RANK = { Stadium: 0, "Indoor arena": 1, Amphitheatre: 2, Venue: 3 };

async function venuesForCity(c) {
  const [city, area, region, country, lat, lng] = c;
  const url = `https://musicbrainz.org/ws/2/place?query=${encodeURIComponent(`${PLACE_TYPES} AND area:"${area}"`)}&fmt=json&limit=40`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const data = await res.json();
    const center = { lat, lng };
    return (data.places || [])
      .filter((p) => p.coordinates && p.name)
      .map((p) => ({ name: p.name, type: p.type, lat: +p.coordinates.latitude, lng: +p.coordinates.longitude, place: `${city}, ${region}, ${country}` }))
      .filter((v) => km(center, v) <= 60)
      .sort((a, b) => (TYPE_RANK[a.type] ?? 4) - (TYPE_RANK[b.type] ?? 4))
      .slice(0, 16);
  } catch (e) {
    console.warn(`  ! ${city}: ${e.message}`);
    return [];
  }
}

async function main() {
  let existing = { artists: {} };
  try { existing = JSON.parse(await readFile(OUT, "utf8")); } catch {}

  const venues = {};
  // Strip legacy generated rows. Provider imports use stable tm_/bit_ ids.
  const tourDates = (existing.tourDates || []).filter((row) => /^(tm|bit)_/.test(String(row?.id || "")));
  const shows = (existing.shows || []).filter((row) => !/^(g|ca)_s_/.test(String(row?.id || "")));

  console.log(`Scraping venues for ${CITIES.length} cities from MusicBrainz…`);
  for (const c of CITIES) {
    const list = await venuesForCity(c);
    for (const v of list) {
      const key = v.name.trim().toLowerCase();
      if (!venues[key]) venues[key] = { name: v.name, place: v.place, lat: v.lat, lng: v.lng, capacity: null, photo: null, photoCredit: null };
    }
    console.log(`  ✓ ${c[0]}: ${list.length} venues`);
    await sleep(1100); // MusicBrainz rate limit
  }

  const out = { artists: existing.artists || {}, venues, shows, tourDates, ingestedAt: new Date().toISOString() };
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log(`  ${Object.keys(out.artists).length} artists · ${Object.keys(venues).length} venues · ${shows.length} shows · ${tourDates.length} upcoming dates`);
}
main();
