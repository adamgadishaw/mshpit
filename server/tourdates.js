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
import { privateErrorLabel } from "./errors.js";
import { canonicalTicketUrl } from "../src/domain/ticketLinks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, "..", "src", "seed", "catalog.generated.json");
const KEY = process.env.TICKETMASTER_KEY;
const BIT = process.env.BANDSINTOWN_APP_ID;
const LIMIT = Number(process.env.TOURDATE_LIMIT) || 150;
const CITY_LIMIT = Number(process.env.TOURDATE_CITY_LIMIT) || 50;
const REFRESH_H = Number(process.env.TOURDATE_REFRESH_H) || 12;
const DAY = 86400000;
const LAST_REFRESH_KEY = "tourdates:last-refresh:v1";
const COUNTRY_CURSOR_KEY = "tourdates:ticketmaster-country-cursor:v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugId = (p, n, v, d) => `${p}_${n}_${v}_${d}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 120);
const norm = (value) => String(value || "").trim().toLowerCase();
export const ticketmasterArtistIdentity = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/\p{Mark}+/gu, "")
  .toLocaleLowerCase("en")
  .replace(/&/g, " and ")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
  .trim();

export function ticketmasterFutureBoundary(at = Date.now()) {
  const parsed = Number(at);
  const date = new Date(Number.isFinite(parsed) ? parsed : Date.now());
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Ticketmaster's Discovery API is international, but its default locale is
// `en`. Keep the default sweep intentionally broad and deterministic while
// allowing operators to narrow it without a deploy. The local-member-city lane
// below remains separate and continues to give active communities priority.
export const DEFAULT_TICKETMASTER_COUNTRIES = Object.freeze([
  "GB", "DE", "FR", "ES", "IT", "NL", "SE", "PL", "AU", "NZ",
  "JP", "KR", "SG", "IN", "BR", "AR", "MX", "ZA", "AE", "IE",
  "AT", "BE", "CH", "DK", "FI", "NO", "PT", "CZ", "GR", "HU",
  "RO", "TR", "CA", "US",
]);

function boundedInteger(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function ticketmasterArtistPageSize(value) {
  return boundedInteger(value, 50, { min: 8, max: 200 });
}

export function ticketmasterCountryBatchSize(value) {
  return boundedInteger(value, 10, { min: 0, max: 25 });
}

export function ticketmasterRequestDelayMs(value) {
  // Ticketmaster documentation has historically described both two- and
  // five-request-per-second defaults. Stay below the conservative boundary so
  // a long global sweep cannot turn a harmless documentation mismatch into a
  // provider-wide 429 burst.
  return boundedInteger(value, 550, { min: 500, max: 5000 });
}

export function ticketmasterCountryCodes(value, fallback = DEFAULT_TICKETMASTER_COUNTRIES) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  const unique = [];
  const seen = new Set();
  for (const entry of raw) {
    const code = String(entry || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    unique.push(code);
  }
  if (unique.length || !fallback) return unique;
  return ticketmasterCountryCodes(fallback, null);
}

export function ticketmasterCountryRotation(countries, cursor, batchSize) {
  const normalized = ticketmasterCountryCodes(countries, null);
  const size = Math.min(normalized.length, ticketmasterCountryBatchSize(batchSize));
  if (!normalized.length || size === 0) return { countries: [], nextCursor: 0 };
  const numericCursor = Number.isFinite(Number(cursor)) ? Math.floor(Number(cursor)) : 0;
  const start = ((numericCursor % normalized.length) + normalized.length) % normalized.length;
  const selected = Array.from({ length: size }, (_, index) => normalized[(start + index) % normalized.length]);
  return { countries: selected, nextCursor: (start + size) % normalized.length };
}

export function ticketmasterEventSearchUrl({
  apiKey,
  keyword,
  city,
  countryCode,
  startDateTime,
  size = 20,
  sort = "date,asc",
} = {}) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  if (keyword) url.searchParams.set("keyword", String(keyword));
  if (city) url.searchParams.set("city", String(city));
  if (countryCode) url.searchParams.set("countryCode", String(countryCode).toUpperCase());
  if (startDateTime) url.searchParams.set("startDateTime", String(startDateTime));
  url.searchParams.set("classificationName", "music");
  url.searchParams.set("locale", "*");
  url.searchParams.set("includeTBA", "no");
  url.searchParams.set("includeTBD", "no");
  url.searchParams.set("size", String(boundedInteger(size, 20, { min: 1, max: 200 })));
  url.searchParams.set("sort", sort);
  url.searchParams.set("apikey", String(apiKey || ""));
  return url.toString();
}

const ARTIST_PAGE_SIZE = ticketmasterArtistPageSize(process.env.TOURDATE_ARTIST_PAGE_SIZE);
const COUNTRY_BATCH_SIZE = ticketmasterCountryBatchSize(process.env.TOURDATE_COUNTRY_BATCH);
const COUNTRY_CODES = ticketmasterCountryCodes(process.env.TOURDATE_COUNTRIES);
const TM_REQUEST_DELAY_MS = ticketmasterRequestDelayMs(process.env.TOURDATE_REQUEST_DELAY_MS);

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
  console.error(`[pit] scheduled tour-date refresh failed safely cause=${privateErrorLabel(error)}`);
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

function storedCountryCursor() {
  return db.prepare("SELECT value FROM app_meta WHERE key=?").get(COUNTRY_CURSOR_KEY)?.value || 0;
}

function markCountryCursor(cursor) {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(COUNTRY_CURSOR_KEY, String(cursor));
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

function ticketmasterRows(data, { requestedArtist = null } = {}) {
  const out = [];
  for (const event of data?._embedded?.events || []) {
    const venue = event._embedded?.venues?.[0];
    const attractions = event._embedded?.attractions || [];
    const requestedIdentity = ticketmasterArtistIdentity(requestedArtist);
    const matchesRequestedArtist = !requestedArtist
      || attractions.some((attraction) => ticketmasterArtistIdentity(attraction.name) === requestedIdentity);
    const artist = requestedArtist || attractions[0]?.name || event.name;
    const date = event.dates?.start?.localDate;
    if (!artist || !venue?.name || !date || !matchesRequestedArtist) continue;
    out.push({
      id: event.id ? `tm_${event.id}` : slugId("tm", artist, venue.name, date), artist, venue: venue.name,
      place: [venue.city?.name, venue.state?.name, venue.country?.name].filter(Boolean).join(", "),
      lat: venue.location?.latitude ? Number(venue.location.latitude) : null,
      lng: venue.location?.longitude ? Number(venue.location.longitude) : null,
      // Ticketmaster's `offsale` means the provider is no longer selling; it
      // does not prove the room sold out. Keep that fan-facing claim false.
      date,
      ticket_url: canonicalTicketUrl(event.url, { source: "ticketmaster", allowUntrusted: false }),
      sold_out: 0,
      source: "ticketmaster",
    });
  }
  return out;
}

async function tmDates(name) {
  if (!KEY) return [];
  const data = await getJSON(ticketmasterEventSearchUrl({
    apiKey: KEY,
    keyword: name,
    size: ARTIST_PAGE_SIZE,
    startDateTime: ticketmasterFutureBoundary(),
  }));
  return ticketmasterRows(data, { requestedArtist: name });
}

// Fill the areas where actual members live. Artist-keyword polling alone can
// produce a large global catalogue with no dates near a Toronto account. The
// official Discovery API supports city + music classification filters, so one
// request per distinct member city gives the local rail useful coverage.
async function tmCityDates(city) {
  if (!KEY || !city) return [];
  const data = await getJSON(ticketmasterEventSearchUrl({ apiKey: KEY, city, size: 200, startDateTime: ticketmasterFutureBoundary() }));
  return ticketmasterRows(data);
}

// A small rotating country batch gives Pit representative worldwide coverage
// without multiplying the per-artist/provider fan-out. One complete sweep takes
// several scheduled runs, and the cursor survives restarts on the same disk.
async function tmCountryDates(countryCode) {
  if (!KEY || !countryCode) return [];
  const data = await getJSON(ticketmasterEventSearchUrl({ apiKey: KEY, countryCode, size: 200, startDateTime: ticketmasterFutureBoundary() }));
  return ticketmasterRows(data);
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
    const ticketUrl = (e.offers || []).find((offer) => offer.type === "Tickets")?.url
      || e.url
      || "https://www.bandsintown.com/";
    out.push({
      id: e.id ? `bit_${e.id}` : slugId("bit", name, v.name, date), artist: name, venue: v.name,
      place: [v.city, v.region, v.country].filter(Boolean).join(", "),
      lat: v.latitude ? Number(v.latitude) : null, lng: v.longitude ? Number(v.longitude) : null,
      date,
      ticket_url: canonicalTicketUrl(ticketUrl, { source: "bandsintown", allowUntrusted: false }),
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

export function hasSuccessfulTourProviderWork(successes) {
  const count = Number(successes);
  return Number.isSafeInteger(count) && count > 0;
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
    const countryBatch = KEY
      ? ticketmasterCountryRotation(COUNTRY_CODES, storedCountryCursor(), COUNTRY_BATCH_SIZE)
      : { countries: [], nextCursor: 0 };
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
      await sleep(TM_REQUEST_DELAY_MS); // stay below provider rate limits
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
      await sleep(TM_REQUEST_DELAY_MS);
    }
    for (const countryCode of countryBatch.countries) {
      try {
        const result = await collectNamedTourProviderResults([
          { source: "ticketmaster", run: () => tmCountryDates(countryCode) },
        ]);
        providerSuccesses += result.successes;
        providerFailures += result.failures;
        recordOutcomes(result.outcomes);
        const now = Date.now();
        db.exec("BEGIN");
        for (const r of result.rows) upsert.run({ lat: null, lng: null, ...r, updated_at: now });
        db.exec("COMMIT");
        total += result.rows.length;
      } catch (e) {
        try { db.exec("ROLLBACK"); }
        catch { /* architecture: allow-empty-catch -- preserve the original country-ingest write failure if rollback itself fails */ }
        throw e;
      }
      await sleep(TM_REQUEST_DELAY_MS);
    }
    if (countryBatch.countries.length) markCountryCursor(countryBatch.nextCursor);
    if (!hasSuccessfulTourProviderWork(providerSuccesses)) {
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
    // A partial provider outage must not turn Render restarts into an immediate
    // replay of the entire worldwide sweep. Successful rows are durable and
    // stale cleanup is already isolated to sources with zero failures, so any
    // useful provider work advances the normal interval. A total outage still
    // throws above and intentionally leaves the refresh due.
    markRefreshed();
    console.log(`[pit] tour dates refreshed: ${total} dates / ${artists.length} artists + ${cities.length} member cities + ${countryBatch.countries.length} global markets (${providerSuccesses} provider calls ok, ${providerFailures} failed) in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    console.error(`[pit] tour-date refresh failed cause=${privateErrorLabel(e)}`);
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
