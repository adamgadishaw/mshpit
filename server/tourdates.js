// In-process tour-date scraper. Runs inside the web server (which owns the SQLite
// DB + persistent disk, a Render cron can't share that disk), on a timer:
// fetches upcoming dates from Ticketmaster and/or Bandsintown for the top artists
// and upserts them into `tour_dates`. GET /api/tourdates serves them, the client
// merges them into its catalog. No git push, no redeploy, live the moment we write.
import { db } from "./db.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, "..", "src", "seed", "catalog.generated.json");
const KEY = process.env.TICKETMASTER_KEY;
const BIT = process.env.BANDSINTOWN_APP_ID;
const LIMIT = Number(process.env.TOURDATE_LIMIT) || 150;
const CITY_LIMIT = Number(process.env.TOURDATE_CITY_LIMIT) || 50;
const REFRESH_H = Number(process.env.TOURDATE_REFRESH_H) || 12;
const DAY = 86400000;
const LAST_REFRESH_KEY = "tourdates:last-refresh:v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugId = (p, n, v, d) => `${p}_${n}_${v}_${d}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 120);
const norm = (value) => String(value || "").trim().toLowerCase();

// Hosted instances opt in explicitly. The full refresh performs one provider
// request per artist, so replaying it after every ephemeral cold start can make
// the web process unavailable and can trip Render's outbound-traffic limits.
export function isTourDateSchedulerEnabled(env = process.env) {
  return backgroundJobEnabled(env, "TOURDATE_REFRESH_ENABLED");
}

// A timer ignores the promise returned by an async callback. Always cross this
// boundary before starting scheduled work so no future refactor can leak a
// rejection into the process-level fatal handler.
export async function runTourDateJobSafely(job, report = (error) => {
  console.error("[pit] scheduled tour-date refresh failed safely:", error);
}) {
  try {
    await job();
    return true;
  } catch (error) {
    try { report(error); } catch {}
    return false;
  }
}

export function shouldRefreshTourDates(lastRefreshAt, now = Date.now(), refreshHours = REFRESH_H) {
  const last = Number(lastRefreshAt) || 0;
  const interval = Math.max(1, Number(refreshHours) || REFRESH_H) * 60 * 60 * 1000;
  return !last || now - last >= interval;
}

function storedLastRefreshAt() {
  return db.prepare("SELECT value FROM app_meta WHERE key=?").get(LAST_REFRESH_KEY)?.value || 0;
}

function markRefreshed(at = Date.now()) {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(LAST_REFRESH_KEY, String(at));
}

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
    const isRequestedArtist = (e._embedded?.attractions || []).some((a) => norm(a.name) === norm(name));
    const date = e.dates?.start?.localDate;
    if (!v?.name || !date || !isRequestedArtist) continue;
    out.push({
      id: e.id ? `tm_${e.id}` : slugId("tm", name, v.name, date), artist: name, venue: v.name,
      place: [v.city?.name, v.state?.name, v.country?.name].filter(Boolean).join(", "),
      lat: v.location?.latitude ? Number(v.location.latitude) : null,
      lng: v.location?.longitude ? Number(v.location.longitude) : null,
      date, ticket_url: e.url, sold_out: e.dates?.status?.code === "offsale" ? 1 : 0, source: "ticketmaster",
    });
  }
  return out;
}

// Fill the areas where actual members live. Artist-keyword polling alone can
// produce a large global catalogue with no dates near a Toronto account. The
// official Discovery API supports city + music classification filters, so one
// request per distinct member city gives the local rail useful coverage.
async function tmCityDates(city) {
  if (!KEY || !city) return [];
  const data = await getJSON(
    `https://app.ticketmaster.com/discovery/v2/events.json?city=${encodeURIComponent(city)}&classificationName=music&size=200&sort=date,asc&apikey=${KEY}`
  );
  const out = [];
  for (const e of data._embedded?.events || []) {
    const v = e._embedded?.venues?.[0];
    const artist = e._embedded?.attractions?.[0]?.name || e.name;
    const date = e.dates?.start?.localDate;
    if (!artist || !v?.name || !date) continue;
    out.push({
      id: e.id ? `tm_${e.id}` : slugId("tm", artist, v.name, date), artist, venue: v.name,
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
    const date = (e.datetime || "").slice(0, 10);
    if (!v.name || !date) continue;
    out.push({
      id: e.id ? `bit_${e.id}` : slugId("bit", name, v.name, date), artist: name, venue: v.name,
      place: [v.city, v.region, v.country].filter(Boolean).join(", "),
      lat: v.latitude ? Number(v.latitude) : null, lng: v.longitude ? Number(v.longitude) : null,
      date, ticket_url: (e.offers || []).find((o) => o.type === "Tickets")?.url || e.url || "https://www.bandsintown.com/",
      sold_out: 0, source: "bandsintown",
    });
  }
  return out;
}

export async function collectTourProviderResults(providers) {
  const active = (providers || []).filter((provider) => typeof provider === "function");
  const settled = await Promise.allSettled(active.map((provider) => provider()));
  return {
    rows: settled.filter((result) => result.status === "fulfilled").flatMap((result) => Array.isArray(result.value) ? result.value : []),
    successes: settled.filter((result) => result.status === "fulfilled").length,
    failures: settled.filter((result) => result.status === "rejected").length,
  };
}

async function collectNamedTourProviderResults(providers) {
  const active = (providers || []).filter((provider) => provider && typeof provider.run === "function");
  const settled = await Promise.allSettled(active.map((provider) => provider.run()));
  return {
    rows: settled.filter((result) => result.status === "fulfilled").flatMap((result) => Array.isArray(result.value) ? result.value : []),
    successes: settled.filter((result) => result.status === "fulfilled").length,
    failures: settled.filter((result) => result.status === "rejected").length,
    outcomes: settled.map((result, index) => ({ source: active[index].source, ok: result.status === "fulfilled" })),
  };
}

export function reconcileStaleProviderTourDates(database, {
  successfulSources,
  staleBefore,
} = {}) {
  const sources = [...new Set((successfulSources || []).filter((source) => /^(ticketmaster|bandsintown)$/.test(source)))];
  const cutoff = Number(staleBefore);
  if (!Number.isSafeInteger(cutoff) || cutoff < 0 || !sources.length) return 0;
  const remove = database.prepare(`DELETE FROM tour_dates
    WHERE owner_id IS NULL AND source=? AND updated_at<?`);
  let deleted = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const source of sources) deleted += Number(remove.run(source, cutoff).changes) || 0;
    database.exec("COMMIT");
    return deleted;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

async function fetchDates(name) {
  const result = await collectNamedTourProviderResults([
    KEY ? { source: "ticketmaster", run: () => tmDates(name) } : null,
    BIT ? { source: "bandsintown", run: () => bitDates(name) } : null,
  ]);
  const byGig = new Map();
  for (const row of result.rows) {
    const k = `${(row.venue || "").toLowerCase()}|${row.date}`;
    if (!byGig.has(k)) byGig.set(k, row);
  }
  return { ...result, rows: [...byGig.values()] };
}

const upsert = db.prepare(`
  INSERT INTO tour_dates (id,artist,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at)
  VALUES (@id,@artist,@venue,@place,@lat,@lng,@date,@ticket_url,@sold_out,@source,@updated_at)
  ON CONFLICT(id) DO UPDATE SET artist=excluded.artist,venue=excluded.venue,place=excluded.place,
    lat=excluded.lat,lng=excluded.lng,date=excluded.date,ticket_url=excluded.ticket_url,
    sold_out=excluded.sold_out,source=excluded.source,updated_at=excluded.updated_at
  WHERE tour_dates.owner_id IS NULL`);

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
    let total = 0, providerSuccesses = 0, providerFailures = 0;
    const providerStats = new Map();
    const recordOutcomes = (outcomes) => {
      for (const outcome of outcomes || []) {
        const stats = providerStats.get(outcome.source) || { successes: 0, failures: 0 };
        stats[outcome.ok ? "successes" : "failures"] += 1;
        providerStats.set(outcome.source, stats);
      }
    };
    for (const a of artists) {
      try {
        const result = await fetchDates(a.name);
        providerSuccesses += result.successes;
        providerFailures += result.failures;
        recordOutcomes(result.outcomes);
        const now = Date.now();
        db.exec("BEGIN");
        for (const r of result.rows) upsert.run({ lat: null, lng: null, ...r, updated_at: now });
        db.exec("COMMIT");
        total += result.rows.length;
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
      await sleep(250); // stay gentle on the APIs (and our event loop)
    }
    const cities = db.prepare(`SELECT home_city city, COUNT(*) members FROM users
      WHERE home_city IS NOT NULL AND trim(home_city) <> ''
      GROUP BY lower(trim(home_city)) ORDER BY members DESC LIMIT ?`).all(CITY_LIMIT);
    for (const { city } of cities) {
      try {
        const result = await collectNamedTourProviderResults([KEY ? { source: "ticketmaster", run: () => tmCityDates(city) } : null]);
        providerSuccesses += result.successes;
        providerFailures += result.failures;
        recordOutcomes(result.outcomes);
        const now = Date.now();
        db.exec("BEGIN");
        for (const r of result.rows) upsert.run({ lat: null, lng: null, ...r, updated_at: now });
        db.exec("COMMIT");
        total += result.rows.length;
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
      await sleep(250);
    }
    if (!providerSuccesses) {
      throw new Error(`Every configured tour provider request failed (${providerFailures} failures); existing dates were kept and the refresh remains due.`);
    }
    // Reconcile only a provider that completed EVERY attempted call. Never let
    // one healthy API erase another provider's cache, and never touch member or
    // staff-authored rows (`owner_id` is non-null).
    const successfulSources = [...providerStats]
      .filter(([, stats]) => stats.successes > 0 && stats.failures === 0)
      .map(([source]) => source);
    reconcileStaleProviderTourDates(db, {
      successfulSources,
      staleBefore: Date.now() - 30 * DAY,
    });
    if (providerFailures === 0) markRefreshed();
    console.log(`[pit] tour dates refreshed: ${total} dates / ${artists.length} artists + ${cities.length} member cities (${providerSuccesses} provider calls ok, ${providerFailures} failed) in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    console.error("[pit] tour-date refresh failed:", e.message);
    throw e;
  } finally { running = false; }
}

export function startTourDateScheduler() {
  if (!isTourDateSchedulerEnabled()) {
    console.log("[pit] tour-date scheduler disabled; set TOURDATE_REFRESH_ENABLED=true to opt in on Render.");
    return;
  }
  if (!KEY && !BIT) {
    console.log("[pit] tour-date scheduler idle, set TICKETMASTER_KEY and/or BANDSINTOWN_APP_ID to enable.");
    return;
  }
  console.log(`[pit] tour-date scheduler on (${[KEY && "Ticketmaster", BIT && "Bandsintown"].filter(Boolean).join(" + ")}, every ${REFRESH_H}h).`);
  const triggerRefresh = () => {
    // Freshness is checked only after this job owns the shared slot. That way a
    // queued timer can cheaply skip work made unnecessary while it was waiting.
    void runTourDateJobSafely(() => runBackgroundJob(async () => {
      if (!shouldRefreshTourDates(storedLastRefreshAt())) return;
      await refresh();
    }));
  };
  // Let health checks and real traffic win the cold-start window. The freshness
  // read itself stays inside the safe job boundary in case SQLite is transiently
  // unavailable during maintenance.
  setTimeout(triggerRefresh, 30_000).unref();
  setInterval(triggerRefresh, REFRESH_H * 3600 * 1000).unref();
}
