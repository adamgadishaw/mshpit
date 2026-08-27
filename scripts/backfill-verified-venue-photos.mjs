#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "src", "seed", "catalog.generated.json");
const OUTPUT = join(HERE, "..", "src", "seed", "catalog.venue-photos.verified.json");
const UA = "MshpitVenuePhotoAudit/1.0 (https://mshpit.com; founder@mshpit.com)";
const limitArg = Number(process.argv.find((value) => /^--limit=/u.test(value))?.split("=")[1] || 75);
const LIMIT = Number.isSafeInteger(limitArg) ? Math.max(1, Math.min(100, limitArg)) : 75;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STOP = new Set(["the", "arena", "centre", "center", "hall", "theatre", "theater", "club", "venue", "stadium"]);
const LICENSE_IDS = Object.freeze({
  "CC BY 2.0": "CC-BY-2.0", "CC BY-SA 2.0": "CC-BY-SA-2.0",
  "CC BY 3.0": "CC-BY-3.0", "CC BY-SA 3.0": "CC-BY-SA-3.0",
  "CC BY 4.0": "CC-BY-4.0", "CC BY-SA 4.0": "CC-BY-SA-4.0",
  "CC0 1.0": "CC0-1.0", "PUBLIC DOMAIN MARK 1.0": "PDM-1.0",
});
const text = (value) => String(value || "").replace(/<[^>]*>/gu, " ")
  .replace(/&quot;/gu, '"').replace(/&#0?39;|&apos;/gu, "'").replace(/&amp;/gu, "&")
  .replace(/\s+/gu, " ").trim();
const norm = (value) => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
  .toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
const radians = (value) => value * Math.PI / 180;
function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function relevant(page, venue) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const titleEvidence = norm(page.title);
  const locationEvidence = norm([page.title, meta.ObjectName?.value, meta.ImageDescription?.value].join(" "));
  const normalizedVenueName = norm(venue.name);
  const venueWords = normalizedVenueName.split(" ").filter(Boolean);
  const tokens = venueWords.filter((token) => token.length >= 3 && !STOP.has(token));
  // Categories/descriptions can mention a venue merely because a portrait or
  // game happened there. The actual file title must name the venue itself.
  if (info?.mime !== "image/jpeg" || venueWords.length < 2 || !tokens.length
    || !titleEvidence.includes(normalizedVenueName)
    || /\b(?:map|logo|diagram|plan|drawing|illustration)\b/iu.test(text(page.title))) return false;
  const city = norm(String(venue.place || "").split(",")[0]);
  const cityMatch = city && locationEvidence.includes(city);
  const gps = { lat: Number(meta.GPSLatitude?.value), lng: Number(meta.GPSLongitude?.value) };
  const nearby = distanceKm(
    { lat: Number(venue.lat), lng: Number(venue.lng) },
    Number.isFinite(gps.lat) && Number.isFinite(gps.lng) ? gps : null,
  );
  return Boolean(cityMatch || (nearby != null && nearby <= 10));
}

function project(page) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const licensed = licensedVenuePhoto({
    uri: info?.thumburl || info?.url,
    sourcePage: info?.descriptionurl,
    creator: text(meta.Artist?.value || meta.Credit?.value),
    license: LICENSE_IDS[text(meta.LicenseShortName?.value).toUpperCase()],
    licenseUrl: meta.LicenseUrl?.value,
    source: "commons",
  });
  return licensed ? { ...licensed, providerTitle: text(page.title) } : null;
}

async function lookup(venue) {
  const city = String(venue.place || "").split(",")[0].trim();
  const query = `\"${venue.name}\" ${city}`.trim();
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query", format: "json", generator: "search", gsrnamespace: "6",
    gsrsearch: query, gsrlimit: "12", prop: "imageinfo", iiprop: "url|extmetadata",
    iiurlwidth: "1600",
  })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Commons ${response.status}`);
  return Object.values((await response.json()).query?.pages || {})
    .filter((page) => relevant(page, venue)).map(project).filter(Boolean).slice(0, 3);
}

const source = JSON.parse(await readFile(SOURCE, "utf8"));
const existing = process.argv.includes("--replace") ? {}
  : JSON.parse(await readFile(OUTPUT, "utf8").catch(() => "{}"));
const venues = Object.entries(source.venues || {}).sort(([, a], [, b]) =>
  Number(Boolean(b.major)) - Number(Boolean(a.major))
  || Number(b.capacity || 0) - Number(a.capacity || 0)
  || String(a.name).localeCompare(String(b.name))).slice(0, LIMIT);
let processed = 0;
for (const [key, venue] of venues) {
  try {
    const galleryPool = await lookup(venue);
    if (galleryPool.length) existing[key] = { galleryPool, photos: galleryPool.map((photo) => photo.uri) };
  } catch (error) { console.warn(`${venue.name}: ${error.message}`); }
  processed++;
  if (processed % 10 === 0) await writeFile(OUTPUT, JSON.stringify(existing, null, 2));
  await sleep(250);
}
await writeFile(OUTPUT, JSON.stringify(existing, null, 2));
console.log(JSON.stringify({ processed, venuesWithPhotos: Object.keys(existing).length,
  photos: Object.values(existing).reduce((sum, entry) => sum + (entry.galleryPool?.length || 0), 0) }));
