#!/usr/bin/env node
/**
 * World venue expansion — ADDITIVE and venue-only. Broadens the catalog beyond
 * US/CA (UK, Ireland, EU, AU/NZ + more US markets) so artists anywhere have real
 * rooms to attach performances to. Pulls real venues (with coordinates) from
 * MusicBrainz (CC0), including arenas/stadiums/amphitheatres, and only ADDS new
 * venues — never overwrites existing ones (photo pools stay intact). No fake
 * dates/shows are generated; these are just real venue facts.
 *
 *   node scripts/ingest-world.mjs
 *
 * Fill photos afterward:  node scripts/enrich-venue-photos.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (https://example.com; contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const km = (a, b) => {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// city, MB area, region, country, lat, lng
const CITIES = [
  // United Kingdom + Ireland
  ["London", "London", "England", "United Kingdom", 51.5074, -0.1278],
  ["Manchester", "Manchester", "England", "United Kingdom", 53.4808, -2.2426],
  ["Glasgow", "Glasgow", "Scotland", "United Kingdom", 55.8642, -4.2518],
  ["Birmingham", "Birmingham", "England", "United Kingdom", 52.4862, -1.8904],
  ["Leeds", "Leeds", "England", "United Kingdom", 53.8008, -1.5491],
  ["Bristol", "Bristol", "England", "United Kingdom", 51.4545, -2.5879],
  ["Dublin", "Dublin", "Leinster", "Ireland", 53.3498, -6.2603],
  // Europe
  ["Paris", "Paris", "Île-de-France", "France", 48.8566, 2.3522],
  ["Berlin", "Berlin", "Berlin", "Germany", 52.52, 13.405],
  ["Hamburg", "Hamburg", "Hamburg", "Germany", 53.5511, 9.9937],
  ["Cologne", "Cologne", "North Rhine-Westphalia", "Germany", 50.9375, 6.9603],
  ["Amsterdam", "Amsterdam", "North Holland", "Netherlands", 52.3676, 4.9041],
  ["Brussels", "Brussels", "Brussels", "Belgium", 50.8503, 4.3517],
  ["Madrid", "Madrid", "Community of Madrid", "Spain", 40.4168, -3.7038],
  ["Barcelona", "Barcelona", "Catalonia", "Spain", 41.3874, 2.1686],
  ["Milan", "Milan", "Lombardy", "Italy", 45.4642, 9.19],
  ["Stockholm", "Stockholm", "Stockholm", "Sweden", 59.3293, 18.0686],
  ["Copenhagen", "Copenhagen", "Capital Region", "Denmark", 55.6761, 12.5683],
  ["Oslo", "Oslo", "Oslo", "Norway", 59.9139, 10.7522],
  // Australia + New Zealand
  ["Sydney", "Sydney", "New South Wales", "Australia", -33.8688, 151.2093],
  ["Melbourne", "Melbourne", "Victoria", "Australia", -37.8136, 144.9631],
  ["Brisbane", "Brisbane", "Queensland", "Australia", -27.4698, 153.0251],
  ["Auckland", "Auckland", "Auckland", "New Zealand", -36.8485, 174.7633],
  // More US markets
  ["Kansas City", "Kansas City", "Missouri", "United States", 39.0997, -94.5786],
  ["Indianapolis", "Indianapolis", "Indiana", "United States", 39.7684, -86.1581],
  ["Cincinnati", "Cincinnati", "Ohio", "United States", 39.1031, -84.512],
  ["Raleigh", "Raleigh", "North Carolina", "United States", 35.7796, -78.6382],
  ["Tampa", "Tampa", "Florida", "United States", 27.9506, -82.4572],
  ["Kansas City", "Kansas City", "Kansas", "United States", 39.1141, -94.6275],
];

const PLACE_TYPES = `(type:Venue OR type:Stadium OR type:"Indoor arena" OR type:Amphitheatre)`;
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
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  cat.venues ||= {};

  console.log(`Adding world venues for ${CITIES.length} cities from MusicBrainz…`);
  let newVenues = 0;
  for (const c of CITIES) {
    const list = await venuesForCity(c);
    for (const v of list) {
      const key = v.name.trim().toLowerCase();
      if (!cat.venues[key]) {
        cat.venues[key] = { name: v.name, place: v.place, lat: v.lat, lng: v.lng, capacity: null, photo: null, photoCredit: null };
        newVenues++;
      }
    }
    console.log(`  ✓ ${c[0]}, ${c[3]}: ${list.length} venues`);
    await sleep(1100); // MusicBrainz rate limit
  }

  cat.ingestedAt = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`\nDone (additive). +${newVenues} new venues. Now: node scripts/enrich-venue-photos.mjs`);
}
main();
