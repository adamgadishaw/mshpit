// In-process tour-date scraper. Runs inside the web server (which owns the SQLite
// DB + persistent disk — a Render cron can't share that disk), on a timer:
// fetches upcoming dates from Ticketmaster and/or Bandsintown for the top artists
// and upserts them into `tour_dates`. GET /api/tourdates serves them, the client
// merges them into its catalog. No git push, no redeploy — live the moment we write.
import { db } from "./db.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, "..", "src", "seed", "catalog.generated.json");
const KEY = process.env.TICKETMASTER_KEY;
const BIT = process.env.BANDSINTOWN_APP_ID;
const LIMIT = Number(process.env.TOURDATE_LIMIT) || 150;
const REFRESH_H = Number(process.env.TOURDATE_REFRESH_H) || 12;
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugId = (p, n, v, d) => `${p}_${n}_${v}_${d}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "mshpit.com" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function tmDates(name) {
  if (!KEY) return [];
  const data = await getJSON(
    `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(name)}&classificationName=music&size=8&sort=date,asc&apikey=${KEY}`
  );
  const out = [];
  for (const e of data._embedded?.events || []) {
    const v = e._embedded?.venues?.[0];
    const date = e.dates?.start?.localDate?.replace(/-/g, " · ");
    if (!v?.name || !date) continue;
    out.push({
      id: slugId("tm", name, v.name, date), artist: name, venue: v.name,
      place: [v.city?.name, v.state?.name, v.country?.name].filter(Boolean).join(", "),
      lat: v.location?.latitude ? Number(v.location.latitude) : null,
      lng: v.location?.longitude ? Number(v.location.longitude) : null,
      date, ticket_url: e.url, sold_out: e.dates?.status?.code === "offsale" ? 1 : 0, source: "ticketmaster",
    });
  }
  return out;
}

async function bitDates(name) {
  if (!BIT) return [];
  const enc = encodeURIComponent(name).replace(/%2F/gi, "%252F");
  const data = await getJSON(`https://rest.bandsintown.com/artists/${enc}/events?app_id=${encodeURIComponent(BIT)}&date=upcoming`);
  const out = [];
  for (const e of Array.isArray(data) ? data : []) {
    const v = e.venue || {};
    const date = (e.datetime || "").slice(0, 10).replace(/-/g, " · ");
    if (!v.name || !date) continue;
    out.push({
      id: slugId("bit", name, v.name, date), artist: name, venue: v.name,
      place: [v.city, v.region, v.country].filter(Boolean).join(", "),
      lat: v.latitude ? Number(v.latitude) : null, lng: v.longitude ? Number(v.longitude) : null,
      date, ticket_url: (e.offers || []).find((o) => o.type === "Tickets")?.url || e.url || "https://www.bandsintown.com/",
      sold_out: 0, source: "bandsintown",
    });
  }
  return out;
}

async function fetchDates(name) {
  const results = await Promise.all([tmDates(name).catch(() => []), bitDates(name).catch(() => [])]);
  const byGig = new Map();
  for (const row of results.flat()) {
    const k = `${(row.venue || "").toLowerCase()}|${row.date}`;
    if (!byGig.has(k)) byGig.set(k, row);
  }
  return [...byGig.values()];
}

const upsert = db.prepare(`
  INSERT INTO tour_dates (id,artist,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at)
  VALUES (@id,@artist,@venue,@place,@lat,@lng,@date,@ticket_url,@sold_out,@source,@updated_at)
  ON CONFLICT(id) DO UPDATE SET sold_out=excluded.sold_out, ticket_url=excluded.ticket_url, place=excluded.place, updated_at=excluded.updated_at`);

let running = false;
async function refresh() {
  if (running || (!KEY && !BIT)) return;
  running = true;
  const t0 = Date.now();
  try {
    const cat = JSON.parse(readFileSync(CATALOG, "utf8"));
    const artists = Object.values(cat.artists || {})
      .filter((a) => a.name)
      .sort((x, y) => (y.popularity || 0) - (x.popularity || 0))
      .slice(0, LIMIT);
    let total = 0;
    for (const a of artists) {
      try {
        const rows = await fetchDates(a.name);
        const now = Date.now();
        db.exec("BEGIN");
        for (const r of rows) upsert.run({ lat: null, lng: null, ...r, updated_at: now });
        db.exec("COMMIT");
        total += rows.length;
      } catch (e) { try { db.exec("ROLLBACK"); } catch {} }
      await sleep(250); // stay gentle on the APIs (and our event loop)
    }
    // Drop dates we haven't seen in a month (past shows / cancellations).
    db.prepare("DELETE FROM tour_dates WHERE updated_at < ?").run(Date.now() - 30 * DAY);
    console.log(`[pit] tour dates refreshed: ${total} dates / ${artists.length} artists in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    console.error("[pit] tour-date refresh failed:", e.message);
  } finally { running = false; }
}

export function startTourDateScheduler() {
  if (!KEY && !BIT) {
    console.log("[pit] tour-date scheduler idle — set TICKETMASTER_KEY and/or BANDSINTOWN_APP_ID to enable.");
    return;
  }
  console.log(`[pit] tour-date scheduler on (${[KEY && "Ticketmaster", BIT && "Bandsintown"].filter(Boolean).join(" + ")}, every ${REFRESH_H}h).`);
  setTimeout(refresh, 20000).unref(); // first pass ~20s after boot
  setInterval(refresh, REFRESH_H * 3600 * 1000).unref();
}
