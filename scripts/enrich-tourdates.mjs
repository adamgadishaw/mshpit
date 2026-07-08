#!/usr/bin/env node
/**
 * Upcoming tour dates + ticket links from the official Ticketmaster Discovery API
 * (no HTML scraping — dates/venues/ticket URLs are facts, and TM's API is the
 * sanctioned source). Fills `catalog.generated.json`'s `tourDates` for artists in
 * the roster, so the app's Nearby / Discover / artist pages show real gigs.
 *
 *   node --env-file=.env scripts/enrich-tourdates.mjs             # top artists by popularity
 *   node --env-file=.env scripts/enrich-tourdates.mjs --all       # every artist in the catalog
 *   TOURDATE_LIMIT=200 node --env-file=.env scripts/enrich-tourdates.mjs
 *
 * Requires TICKETMASTER_KEY (free: developer.ticketmaster.com). Re-run to refresh:
 * it replaces the previously-imported dates for each artist it queries.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const KEY = process.env.TICKETMASTER_KEY;
const LIMIT = Number(process.env.TOURDATE_LIMIT) || 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000); // never hang (matches pipeline watchdog spirit)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "mshpit.com catalog" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Ticketmaster Discovery → the tourDates shape the app already uses.
async function upcomingDates(name) {
  const data = await getJSON(
    `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(name)}` +
    `&classificationName=music&size=8&sort=date,asc&apikey=${KEY}`
  );
  const out = [];
  for (const e of data._embedded?.events || []) {
    const v = e._embedded?.venues?.[0];
    const date = e.dates?.start?.localDate?.replace(/-/g, " · ");
    if (!v?.name || !date) continue;
    out.push({
      id: `tm_${name}_${v.name}_${date}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60),
      artist: name,
      venue: v.name,
      place: [v.city?.name, v.state?.name, v.country?.name].filter(Boolean).join(", "),
      lat: v.location?.latitude ? Number(v.location.latitude) : null,
      lng: v.location?.longitude ? Number(v.location.longitude) : null,
      date,
      ticketUrl: e.url,
      releaseAt: Date.now() - DAY, // already public
      createdBy: "import",
      soldOut: e.dates?.status?.code === "offsale",
    });
  }
  return out;
}

async function main() {
  if (!KEY) {
    console.error("Set TICKETMASTER_KEY (free at developer.ticketmaster.com) to fetch tour dates.");
    process.exit(1);
  }
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const artists = Object.values(cat.artists || {});
  const all = process.argv.includes("--all");
  // Highest-popularity artists first — that's where fans expect dates, and it caps
  // API calls on the free tier. Roster growth surfaces new names next runs.
  const targets = artists
    .filter((a) => a.name)
    .sort((x, y) => (y.popularity || 0) - (x.popularity || 0))
    .slice(0, all ? artists.length : LIMIT);

  console.log(`Querying Ticketmaster for ${targets.length} artist(s)…`);
  cat.tourDates = cat.tourDates || [];
  const queried = new Set(targets.map((a) => a.name.toLowerCase()));
  // Drop prior imported rows for the artists we're refreshing (keep everyone else's).
  cat.tourDates = cat.tourDates.filter((t) => !(t.createdBy === "import" && queried.has((t.artist || "").toLowerCase())));

  let done = 0, dates = 0, withDates = 0;
  for (const a of targets) {
    try {
      const rows = await upcomingDates(a.name);
      if (rows.length) {
        // dedupe by id within the merged set
        const have = new Set(cat.tourDates.map((t) => t.id));
        for (const r of rows) if (!have.has(r.id)) { cat.tourDates.push(r); dates++; }
        withDates++;
      }
    } catch (e) { console.warn(`  ! ${a.name}: ${e.message}`); }
    if (++done % 25 === 0) { console.log(`  …${done}/${targets.length} (${dates} dates)`); await writeFile(OUT, JSON.stringify(cat, null, 2)); }
    await sleep(250); // TM free tier: 5 req/sec — stay well under
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${dates} upcoming dates across ${withDates} artists (${cat.tourDates.length} total in catalog).`);
}
main();
