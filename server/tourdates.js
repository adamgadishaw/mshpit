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
import { bandsintownMusicEvent, ticketmasterMusicEvent } from "./musicEventClassification.js";
import { selectTicketmasterEventImage } from "./providerEventImage.js";
import { deriveTourNameFromEventTitle } from "./tourDateMetadata.js";
import {
  collectTicketmasterPartitionedMarket,
  ticketmasterMarketCoverageKey,
} from "./ticketmasterMarketCoverage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, "..", "src", "seed", "catalog.generated.json");
const KEY = process.env.TICKETMASTER_KEY;
const BIT = process.env.BANDSINTOWN_APP_ID;
const LIMIT = Number(process.env.TOURDATE_LIMIT) || 150;
const CITY_LIMIT = Number(process.env.TOURDATE_CITY_LIMIT) || 50;
const REFRESH_H = Number(process.env.TOURDATE_REFRESH_H) || 12;
const DAY = 86400000;
const LAST_REFRESH_KEY = "tourdates:last-refresh:v1";
const INGESTION_REVISION_KEY = "tourdates:ingestion-revision";
const ARTIST_CURSOR_KEY = "tourdates:artist-cursor:v1";
const COUNTRY_CURSOR_KEY = "tourdates:ticketmaster-country-cursor:v1";
const MARKET_COVERAGE_KEY_PREFIX = "tourdates:ticketmaster-market-coverage:v1:";
// Bump this only when a deployed collector materially changes what it can
// discover. The persisted value makes that release run once even when the
// ordinary freshness clock is still recent, without replaying on every deploy.
export const TOURDATE_INGESTION_REVISION = "live-catalog-demand-partitioned-90d-v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugId = (p, n, v, d) => `${p}_${n}_${v}_${d}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 120);
const norm = (value) => String(value || "").trim().toLowerCase();
const optionalText = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value).trim() || null;
};
const optionalCoordinate = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function absoluteIsoTime(value) {
  const text = optionalText(value);
  // A provider-local wall clock is not an absolute instant. Keep it in
  // start_local_time unless the provider supplied Z or an explicit offset.
  if (!text || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
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

export function ticketmasterActiveAndFutureRange(at = Date.now(), horizonDays = 3 * 366) {
  const parsed = Number(at);
  const start = Number.isFinite(parsed) ? parsed : Date.now();
  const days = boundedInteger(horizonDays, 3 * 366, { min: 1, max: 5 * 366 });
  return [
    ticketmasterFutureBoundary(start),
    ticketmasterFutureBoundary(start + days * DAY),
  ];
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
  // One provider call costs the same at 200 rows and prevents prolific touring
  // artists from being permanently truncated after their first 50 dates.
  return boundedInteger(value, 200, { min: 8, max: 200 });
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

export function tourDateArtistRotationSize(value, limit = LIMIT) {
  const safeLimit = boundedInteger(limit, LIMIT, { min: 1, max: 1000 });
  return boundedInteger(value, Math.max(1, Math.floor(safeLimit * 2 / 3)), { min: 0, max: safeLimit });
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
  startEndDateTime,
  size = 20,
  page,
  sort = "date,asc",
} = {}) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  if (keyword) url.searchParams.set("keyword", String(keyword));
  if (city) url.searchParams.set("city", String(city));
  if (countryCode) url.searchParams.set("countryCode", String(countryCode).toUpperCase());
  if (startDateTime) url.searchParams.set("startDateTime", String(startDateTime));
  if (startEndDateTime) {
    const range = Array.isArray(startEndDateTime) ? startEndDateTime : [startEndDateTime];
    const values = range.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 2);
    if (values.length) url.searchParams.set("startEndDateTime", values.join(","));
  }
  url.searchParams.set("classificationName", "music");
  url.searchParams.set("locale", "*");
  url.searchParams.set("includeTBA", "no");
  url.searchParams.set("includeTBD", "no");
  const pageSize = boundedInteger(size, 20, { min: 1, max: 200 });
  url.searchParams.set("size", String(pageSize));
  if (page !== undefined && page !== null && page !== "") {
    // Ticketmaster rejects deep pages where size * page reaches 1,000. Clamp
    // centrally so every caller, including future ones, stays inside that
    // provider boundary (size 200 therefore permits pages 0 through 4).
    const maxPage = Math.floor(999 / pageSize);
    url.searchParams.set("page", String(boundedInteger(page, 0, { min: 0, max: maxPage })));
  }
  url.searchParams.set("sort", sort);
  url.searchParams.set("apikey", String(apiKey || ""));
  return url.toString();
}

const ARTIST_PAGE_SIZE = ticketmasterArtistPageSize(process.env.TOURDATE_ARTIST_PAGE_SIZE);
const COUNTRY_BATCH_SIZE = ticketmasterCountryBatchSize(process.env.TOURDATE_COUNTRY_BATCH);
const COUNTRY_CODES = ticketmasterCountryCodes(process.env.TOURDATE_COUNTRIES);
const TM_REQUEST_DELAY_MS = ticketmasterRequestDelayMs(process.env.TOURDATE_REQUEST_DELAY_MS);
const ARTIST_ROTATION_SIZE = tourDateArtistRotationSize(process.env.TOURDATE_ROTATION_SIZE, LIMIT);

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
    try { report(error); }
    catch { /* architecture: allow-empty-catch -- diagnostic reporting cannot escape the scheduler safety boundary */ }
    return false;
  }
}

export function shouldRefreshTourDates(lastRefreshAt, now = Date.now(), refreshHours = REFRESH_H) {
  const last = Number(lastRefreshAt) || 0;
  const interval = Math.max(1, Number(refreshHours) || REFRESH_H) * 60 * 60 * 1000;
  return !last || now - last >= interval;
}

export function shouldRefreshTourDateIngestion({
  lastRefreshAt,
  storedRevision,
  now = Date.now(),
  refreshHours = REFRESH_H,
  currentRevision = TOURDATE_INGESTION_REVISION,
} = {}) {
  const expected = optionalText(currentRevision);
  const completed = optionalText(storedRevision);
  return (expected && completed !== expected)
    || shouldRefreshTourDates(lastRefreshAt, now, refreshHours);
}

function storedLastRefreshAt() {
  return db.prepare("SELECT value FROM app_meta WHERE key=?").get(LAST_REFRESH_KEY)?.value || 0;
}

function storedIngestionRevision() {
  return db.prepare("SELECT value FROM app_meta WHERE key=?").get(INGESTION_REVISION_KEY)?.value || "";
}

function storedArtistCursor() {
  return db.prepare("SELECT value FROM app_meta WHERE key=?").get(ARTIST_CURSOR_KEY)?.value || "";
}

function markRefreshComplete(at = Date.now(), artistCursor = null) {
  const timestamp = Number(at);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("refresh completion time must be a non-negative integer");
  const write = db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.transaction(() => {
    write.run(LAST_REFRESH_KEY, String(timestamp));
    write.run(INGESTION_REVISION_KEY, TOURDATE_INGESTION_REVISION);
    if (typeof artistCursor === "string") write.run(ARTIST_CURSOR_KEY, artistCursor);
  })();
}

function storedCountryCursor() {
  return db.prepare("SELECT value FROM app_meta WHERE key=?").get(COUNTRY_CURSOR_KEY)?.value || 0;
}

function markCountryCursor(cursor) {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(COUNTRY_CURSOR_KEY, String(cursor));
}

export function ticketmasterMarketCoverageMetaKey(market) {
  const key = ticketmasterMarketCoverageKey(market);
  return key ? `${MARKET_COVERAGE_KEY_PREFIX}${key}` : null;
}

export function readTicketmasterMarketCoverageState(database, market) {
  if (!database?.prepare) throw new TypeError("market coverage state requires a database");
  const key = ticketmasterMarketCoverageMetaKey(market);
  if (!key) return null;
  const value = database.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTicketmasterMarketCoverageState(database, market, state) {
  if (!database?.prepare) throw new TypeError("market coverage state requires a database");
  const key = ticketmasterMarketCoverageMetaKey(market);
  if (!key || !state || typeof state !== "object" || Array.isArray(state)) return false;
  const value = JSON.stringify(state);
  if (value.length > 100_000) throw new RangeError("market coverage state is unexpectedly large");
  database.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value);
  return true;
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

// Provider capacity is deliberately bounded, so spend the artist lane on the
// live catalogue rather than the much smaller bundled seed. Ranking uses only
// canonical public artist names and aggregate non-private product demand. Private attendance,
// listening history, saved favourites, member ids, and profile fields never
// leave the database or affect this provider work queue.
export function selectTourDateRefreshArtists(database, {
  limit = LIMIT,
  rotationSize,
  cursor = "",
  fallbackArtists = [],
  now = Date.now(),
} = {}) {
  if (!database?.prepare) throw new TypeError("tour-date artist selection requires a database");
  const safeLimit = boundedInteger(limit, LIMIT, { min: 1, max: 1000 });
  const safeRotationSize = tourDateArtistRotationSize(rotationSize, safeLimit);
  const priorityLimit = safeLimit - safeRotationSize;
  const candidateLimit = Math.min(4000, safeLimit * 4);
  const signalWindow = Math.min(20000, Math.max(1000, safeLimit * 100));
  const requestedAt = Number(now);
  const activeAt = Number.isFinite(requestedAt) && requestedAt >= 0
    ? Math.floor(requestedAt)
    : Date.now();
  const optionalRows = (sql, ...args) => {
    try { return database.prepare(sql).all(...args); }
    catch (error) {
      if (/no such (?:table|column)/i.test(String(error?.message || ""))) return [];
      throw error;
    }
  };
  const demanded = priorityLimit > 0 ? [
    ...optionalRows(`
      SELECT a.name,a.popularity,a.rank_score,COUNT(*) * 40 demand_score
      FROM (SELECT p.artist_key,p.artist FROM posts p
        JOIN users demand_user ON demand_user.id=p.user_id
        WHERE p.removed=0 AND length(TRIM(p.artist))>0
          AND demand_user.is_banned=0
          AND (demand_user.suspended_until IS NULL OR demand_user.suspended_until<=?)
        ORDER BY p.created_at DESC LIMIT ?) p
      JOIN artists a ON a.norm=COALESCE(NULLIF(TRIM(p.artist_key),''),LOWER(TRIM(p.artist)))
      GROUP BY a.norm,a.name,a.popularity,a.rank_score
      ORDER BY demand_score DESC LIMIT ?`, activeAt, signalWindow, candidateLimit),
    ...optionalRows(`
      SELECT a.name,a.popularity,a.rank_score,COUNT(*) * 60 demand_score
      FROM (SELECT f.artist FROM fan_club_members f
        JOIN users demand_user ON demand_user.id=f.user_id
        WHERE length(TRIM(f.artist))>0
          AND demand_user.is_banned=0
          AND (demand_user.suspended_until IS NULL OR demand_user.suspended_until<=?)
        LIMIT ?) f
      JOIN artists a ON a.norm=LOWER(TRIM(f.artist))
      GROUP BY a.norm,a.name,a.popularity,a.rank_score
      ORDER BY demand_score DESC LIMIT ?`, activeAt, signalWindow, candidateLimit),
    ...optionalRows(`
      SELECT a.name,a.popularity,a.rank_score,COUNT(*) * 80 demand_score
      FROM (SELECT attendance.show_id,attendance.legacy_artist FROM show_attendance attendance
        JOIN users demand_user ON demand_user.id=attendance.user_id
        WHERE attendance.visibility<>'private'
          AND attendance.state IN ('interested','going','here','went')
          AND demand_user.is_banned=0
          AND (demand_user.suspended_until IS NULL OR demand_user.suspended_until<=?)
        LIMIT ?) sa
      JOIN shows s ON s.id=sa.show_id
      JOIN artists a ON a.norm=COALESCE(NULLIF(TRIM(s.artist_key),''),LOWER(TRIM(COALESCE(NULLIF(s.artist,''),sa.legacy_artist))))
      GROUP BY a.norm,a.name,a.popularity,a.rank_score
      ORDER BY demand_score DESC LIMIT ?`, activeAt, signalWindow, candidateLimit),
    ...optionalRows(`
      SELECT a.name,a.popularity,a.rank_score,COUNT(*) * 120 demand_score
      FROM (SELECT profile.artist_key FROM artist_profiles profile
        JOIN users demand_user ON demand_user.id=profile.owner_id
        WHERE profile.removed=0
          AND demand_user.is_banned=0
          AND (demand_user.suspended_until IS NULL OR demand_user.suspended_until<=?)
        LIMIT ?) ap
      JOIN artists a ON a.norm=TRIM(ap.artist_key)
      GROUP BY a.norm,a.name,a.popularity,a.rank_score
      ORDER BY demand_score DESC LIMIT ?`, activeAt, signalWindow, candidateLimit),
    ...optionalRows(`
      SELECT a.name,a.popularity,a.rank_score,15 demand_score
      FROM (SELECT artist_key,artist FROM tour_dates
        WHERE provider_active=1 AND owner_id IS NULL AND date>=? LIMIT ?) td
      JOIN artists a ON a.norm=COALESCE(NULLIF(TRIM(td.artist_key),''),LOWER(TRIM(td.artist)))
      GROUP BY a.norm,a.name,a.popularity,a.rank_score
      ORDER BY a.popularity DESC,a.rank_score DESC LIMIT ?`,
    new Date(activeAt).toISOString().slice(0, 10), signalWindow, candidateLimit),
  ] : [];
  const popular = priorityLimit > 0 ? optionalRows(`
    SELECT name,popularity,rank_score,0 demand_score
    FROM artists
    WHERE length(TRIM(name)) BETWEEN 1 AND 160
    ORDER BY COALESCE(popularity,0) DESC,rank_score DESC,name COLLATE NOCASE
    LIMIT ?
  `, candidateLimit) : [];

  const candidates = new Map();
  const add = (row) => {
    const name = optionalText(row?.name);
    const key = ticketmasterArtistIdentity(name);
    if (!name || name.length > 160 || !key) return;
    const prior = candidates.get(key);
    const candidate = {
      name,
      demandScore: Number(row?.demand_score) || 0,
      popularity: Number(row?.popularity) || 0,
      rankScore: Number(row?.rank_score) || 0,
    };
    if (!prior) candidates.set(key, candidate);
    else candidates.set(key, {
      name: candidate.popularity > prior.popularity ? candidate.name : prior.name,
      demandScore: prior.demandScore + candidate.demandScore,
      popularity: Math.max(prior.popularity, candidate.popularity),
      rankScore: Math.max(prior.rankScore, candidate.rankScore),
    });
  };
  for (const row of demanded) add(row);
  for (const row of popular) add(row);

  const ranked = [...candidates.values()].sort((left, right) =>
    right.demandScore - left.demandScore
    || right.popularity - left.popularity
    || right.rankScore - left.rankScore
    || left.name.localeCompare(right.name));
  const selected = ranked.slice(0, priorityLimit);
  const selectedKeys = new Set(selected.map((artist) => ticketmasterArtistIdentity(artist.name)));

  // The second lane advances through the canonical live catalogue by norm. Its
  // cursor is returned to the caller and is persisted only after a successful
  // refresh, so restarts repeat the same safe slice instead of skipping work.
  const cursorText = optionalText(cursor) || "";
  let nextCursor = cursorText;
  if (safeRotationSize > 0) {
    const rotationScanLimit = Math.min(4000, Math.max(safeLimit * 4, safeRotationSize * 4));
    const after = optionalRows(`SELECT norm,name,popularity,rank_score FROM artists
      WHERE norm>? AND length(TRIM(name)) BETWEEN 1 AND 160 ORDER BY norm LIMIT ?`, cursorText, rotationScanLimit);
    const wrapLimit = rotationScanLimit - after.length;
    const wrapped = cursorText && wrapLimit > 0
      ? optionalRows(`SELECT norm,name,popularity,rank_score FROM artists
          WHERE norm<=? AND length(TRIM(name)) BETWEEN 1 AND 160 ORDER BY norm LIMIT ?`, cursorText, wrapLimit)
      : [];
    let rotatingAdded = 0;
    for (const row of [...after, ...wrapped]) {
      const rowCursor = optionalText(row?.norm);
      if (rowCursor) nextCursor = rowCursor;
      const name = optionalText(row?.name);
      const key = ticketmasterArtistIdentity(name);
      if (!name || name.length > 160 || !key || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push({
        name,
        popularity: Number(row.popularity) || 0,
        rankScore: Number(row.rank_score) || 0,
        demandScore: 0,
      });
      rotatingAdded += 1;
      if (rotatingAdded >= safeRotationSize) break;
    }
  }

  // The generated catalogue remains a startup/offline safety net only. It can
  // fill an unusually sparse database, but it can never displace live demand.
  if (selected.length < safeLimit) {
    const fallback = (Array.isArray(fallbackArtists) ? fallbackArtists : Object.values(fallbackArtists || {}))
      .filter((artist) => optionalText(artist?.name))
      .sort((left, right) => (Number(right?.popularity) || 0) - (Number(left?.popularity) || 0));
    for (const artist of fallback) {
      if (selected.length >= safeLimit) break;
      const name = optionalText(artist.name);
      const key = ticketmasterArtistIdentity(name);
      if (!name || name.length > 160 || !key || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push({ name, popularity: Number(artist.popularity) || 0, rankScore: 0, demandScore: 0 });
    }
  }

  return {
    artists: selected.map(({ name, popularity }) => ({ name, popularity })),
    nextCursor,
  };
}

export function ticketmasterRows(data, { requestedArtist = null } = {}) {
  const out = [];
  for (const event of data?._embedded?.events || []) {
    const musicEvent = ticketmasterMusicEvent(event, { requestedArtist });
    if (!musicEvent) continue;
    const venue = event._embedded?.venues?.[0];
    const attractions = event._embedded?.attractions || [];
    const requestedIdentity = ticketmasterArtistIdentity(requestedArtist);
    const matchesRequestedArtist = !requestedArtist
      || attractions.some((attraction) => ticketmasterArtistIdentity(attraction.name) === requestedIdentity);
    const artist = requestedArtist || attractions[0]?.name || event.name;
    const date = optionalText(event.dates?.start?.localDate);
    if (!artist || !venue?.name || !date || !matchesRequestedArtist) continue;
    const localTime = optionalText(event.dates?.start?.localTime);
    const countryCode = optionalText(venue.country?.countryCode);
    const eventImage = selectTicketmasterEventImage(event);
    const officialEventName = optionalText(event.name);
    const accessStartDateTime = absoluteIsoTime(event.dates?.access?.startDateTime);
    out.push({
      id: event.id ? `tm_${event.id}` : slugId("tm", artist, venue.name, date), artist, venue: venue.name,
      place: [venue.city?.name, venue.state?.name, venue.country?.name].filter(Boolean).join(", "),
      lat: optionalCoordinate(venue.location?.latitude),
      lng: optionalCoordinate(venue.location?.longitude),
      // Ticketmaster's `offsale` means the provider is no longer selling; it
      // does not prove the room sold out. Keep that fan-facing claim false.
      date,
      ticket_url: canonicalTicketUrl(event.url, { source: "ticketmaster", allowUntrusted: false }),
      sold_out: 0,
      source: "ticketmaster",
      provider_event_id: optionalText(event.id),
      event_name: officialEventName,
      tour_name: deriveTourNameFromEventTitle({
        eventName: officialEventName,
        artist,
        eventKind: musicEvent.kind,
      }),
      start_date_time: absoluteIsoTime(event.dates?.start?.dateTime),
      start_local_time: localTime ? `${date}T${localTime}` : date,
      access_start_date_time: accessStartDateTime,
      access_start_approximate: accessStartDateTime
        ? (event.dates?.access?.startApproximate === true ? 1 : 0)
        : null,
      event_timezone: optionalText(venue.timezone),
      event_status: optionalText(event.dates?.status?.code)?.toLowerCase() || null,
      venue_provider_id: optionalText(venue.id),
      venue_address_line1: optionalText(venue.address?.line1),
      venue_address_line2: optionalText(venue.address?.line2),
      venue_city: optionalText(venue.city?.name),
      venue_region: optionalText(venue.state?.stateCode) || optionalText(venue.state?.name),
      venue_postal_code: optionalText(venue.postalCode),
      venue_country_code: countryCode?.toUpperCase() || null,
      venue_country: optionalText(venue.country?.name),
      provider_active: 1,
      event_kind: musicEvent.kind,
      music_qualified: 1,
      music_evidence: musicEvent.evidence,
      billed_artists: musicEvent.billedArtists,
      event_end_date: musicEvent.endDate,
      event_image_url: eventImage?.uri ?? null,
      event_image_attribution: eventImage?.attribution ?? null,
      event_image_width: eventImage?.width ?? null,
      event_image_height: eventImage?.height ?? null,
    });
  }
  return out;
}

const TICKETMASTER_CITY_PAGE_SIZE = 200;
const TICKETMASTER_CITY_COVERAGE_DAYS = 90;
const TICKETMASTER_CITY_MAX_PAGES = 5;

function ticketmasterCoverageDate(startEndDateTime, coverageDays) {
  const start = Date.parse(Array.isArray(startEndDateTime) ? startEndDateTime[0] : startEndDateTime);
  const base = Number.isFinite(start) ? start : Date.now();
  return new Date(base + coverageDays * DAY).toISOString().slice(0, 10);
}

function ticketmasterResponseEvents(data) {
  return Array.isArray(data?._embedded?.events) ? data._embedded.events : [];
}

function ticketmasterResponseExhausted(data, requestedPage, pageSize) {
  const totalPages = Number(data?.page?.totalPages);
  if (Number.isSafeInteger(totalPages) && totalPages >= 0) return requestedPage + 1 >= totalPages;
  return ticketmasterResponseEvents(data).length < pageSize;
}

// Dense cities and countries can fill Ticketmaster's first 200 chronological
// results before day 90. Continue through a small, provider-safe page budget
// until the response proves that the first 90 days are covered. The original
// multi-year range is kept intact; this only prevents page zero from becoming
// an accidental horizon.
//
// A later-page failure returns the already verified rows with `complete:false`.
// The caller persists that useful partial work but records a provider failure,
// which prevents a partial scan from authorizing source-wide stale cleanup.
export async function collectTicketmasterRangePages({
  apiKey,
  city,
  countryCode,
  startEndDateTime = ticketmasterActiveAndFutureRange(),
  fetchJson = getJSON,
  wait = sleep,
  requestDelayMs = TM_REQUEST_DELAY_MS,
  pageSize = TICKETMASTER_CITY_PAGE_SIZE,
  coverageDays = TICKETMASTER_CITY_COVERAGE_DAYS,
  maxPages = TICKETMASTER_CITY_MAX_PAGES,
} = {}) {
  if (!apiKey || (!city && !countryCode)) {
    return { rows: [], complete: true, coverageReached: false, pagesFetched: 0 };
  }
  const safePageSize = boundedInteger(pageSize, TICKETMASTER_CITY_PAGE_SIZE, { min: 1, max: 200 });
  // With 200 results per page, five pages (0..4) is Ticketmaster's hard deep-
  // paging ceiling. A lower test page size still uses this same conservative
  // request-count cap to keep the web process responsive.
  const safeMaxPages = boundedInteger(maxPages, TICKETMASTER_CITY_MAX_PAGES, { min: 1, max: 5 });
  const safeCoverageDays = boundedInteger(coverageDays, TICKETMASTER_CITY_COVERAGE_DAYS, { min: 1, max: 366 });
  const safeDelay = boundedInteger(requestDelayMs, TM_REQUEST_DELAY_MS, { min: 0, max: 5000 });
  const targetDate = ticketmasterCoverageDate(startEndDateTime, safeCoverageDays);
  const rowsById = new Map();
  let pagesFetched = 0;
  let coverageReached = false;

  for (let page = 0; page < safeMaxPages; page += 1) {
    if (page > 0 && safeDelay > 0) await wait(safeDelay);
    let data;
    try {
      data = await fetchJson(ticketmasterEventSearchUrl({
        apiKey,
        city,
        countryCode,
        size: safePageSize,
        page,
        startEndDateTime,
      }));
    } catch (error) {
      if (pagesFetched === 0) throw error;
      return {
        rows: [...rowsById.values()],
        complete: false,
        coverageReached,
        pagesFetched,
        error,
      };
    }

    pagesFetched += 1;
    const pageRows = ticketmasterRows(data);
    for (const row of pageRows) {
      const identity = row.provider_event_id || row.id;
      if (identity && !rowsById.has(identity)) rowsById.set(identity, row);
    }
    // Only a row that passed the music/event/venue qualification proves useful
    // catalogue coverage. A filtered sports event or malformed provider row at
    // day 90 must not end the market scan before later music pages are checked.
    if (pageRows.some((row) => row.date >= targetDate)) coverageReached = true;
    const exhausted = ticketmasterResponseExhausted(data, page, safePageSize);
    if (coverageReached || exhausted) {
      return {
        rows: [...rowsById.values()],
        complete: true,
        coverageReached,
        pagesFetched,
      };
    }
  }

  // The provider's deep-page ceiling was reached before its chronological
  // result set demonstrated 90-day coverage. Keep the rows, but fail closed for
  // stale reconciliation rather than pretending this was a complete scan.
  return {
    rows: [...rowsById.values()],
    complete: false,
    coverageReached,
    pagesFetched,
  };
}

export function collectTicketmasterCityPages(options = {}) {
  return collectTicketmasterRangePages(options);
}

export function collectTicketmasterCountryPages(options = {}) {
  return collectTicketmasterRangePages(options);
}

export async function collectTicketmasterMarketPartitions({
  apiKey,
  city,
  countryCode,
  state,
  fetchJson = getJSON,
  wait = sleep,
  requestDelayMs = TM_REQUEST_DELAY_MS,
  now = Date.now(),
  horizonDays,
  defaultWindowDays,
  maxRequests,
  pageSize,
} = {}) {
  if (!apiKey || (!city && !countryCode)) {
    return {
      rows: [],
      complete: false,
      requestComplete: false,
      cycleComplete: false,
      coverageComplete: false,
      requestsUsed: 0,
      nextState: state || null,
    };
  }
  return collectTicketmasterPartitionedMarket({
    state,
    now,
    horizonDays,
    defaultWindowDays,
    maxRequests,
    pageSize,
    fetchJson,
    wait,
    requestDelayMs,
    buildUrl: ({ startEndDateTime, size, page }) => ticketmasterEventSearchUrl({
      apiKey,
      city,
      countryCode,
      startEndDateTime,
      size,
      page,
    }),
    rowsFromResponse: ticketmasterRows,
  });
}

async function tmDates(name) {
  if (!KEY) return [];
  const data = await getJSON(ticketmasterEventSearchUrl({
    apiKey: KEY,
    keyword: name,
    size: ARTIST_PAGE_SIZE,
    startEndDateTime: ticketmasterActiveAndFutureRange(),
  }));
  return ticketmasterRows(data, { requestedArtist: name });
}

// Fill the areas where actual members live. Artist-keyword polling alone can
// produce a large global catalogue with no dates near a Toronto account. The
// official Discovery API supports city + music classification filters, so one
// request per distinct member city gives the local rail useful coverage.
async function tmCityDates(city) {
  if (!KEY || !city) return [];
  return collectTicketmasterMarketPartitions({
    apiKey: KEY,
    city,
    state: readTicketmasterMarketCoverageState(db, { city }),
  });
}

// A small rotating country batch gives Pit representative worldwide coverage
// without multiplying the per-artist/provider fan-out. One complete sweep takes
// several scheduled runs, and the cursor survives restarts on the same disk.
async function tmCountryDates(countryCode) {
  if (!KEY || !countryCode) return [];
  return collectTicketmasterMarketPartitions({
    apiKey: KEY,
    countryCode,
    state: readTicketmasterMarketCoverageState(db, { countryCode }),
  });
}

export function bandsintownRows(data, { requestedArtist = null } = {}) {
  const out = [];
  for (const e of Array.isArray(data) ? data : []) {
    const musicEvent = bandsintownMusicEvent(e, { requestedArtist });
    if (!musicEvent) continue;
    const v = e.venue || {};
    const artist = optionalText(requestedArtist) || optionalText(e.artist?.name) || optionalText(e.lineup?.[0]);
    const localStart = optionalText(e.datetime);
    const date = localStart && /^\d{4}-\d{2}-\d{2}/.test(localStart) ? localStart.slice(0, 10) : null;
    if (!artist || !v.name || !date) continue;
    const ticketUrl = (e.offers || []).find((offer) => offer.type === "Tickets")?.url
      || e.url
      || "https://www.bandsintown.com/";
    const countryCode = optionalText(v.country_code || v.countryCode);
    const explicitStatus = optionalText(e.status);
    const officialEventName = optionalText(e.title);
    out.push({
      id: e.id ? `bit_${e.id}` : slugId("bit", artist, v.name, date), artist, venue: v.name,
      place: [v.city, v.region, v.country].filter(Boolean).join(", "),
      lat: optionalCoordinate(v.latitude), lng: optionalCoordinate(v.longitude),
      date,
      ticket_url: canonicalTicketUrl(ticketUrl, { source: "bandsintown", allowUntrusted: false }),
      sold_out: 0, source: "bandsintown",
      provider_event_id: optionalText(e.id),
      event_name: officialEventName || optionalText(e.artist?.name) || artist,
      tour_name: deriveTourNameFromEventTitle({
        eventName: officialEventName,
        artist,
        eventKind: musicEvent.kind,
      }),
      start_date_time: absoluteIsoTime(localStart),
      start_local_time: localStart,
      access_start_date_time: null,
      access_start_approximate: null,
      event_timezone: optionalText(e.timezone) || optionalText(v.timezone),
      event_status: (explicitStatus || (e.cancelled === true ? "cancelled" : null))?.toLowerCase() || null,
      venue_provider_id: optionalText(v.id),
      venue_address_line1: optionalText(v.street_address || v.address),
      venue_address_line2: optionalText(v.street_address_2 || v.address2),
      venue_city: optionalText(v.city),
      venue_region: optionalText(v.region),
      venue_postal_code: optionalText(v.postal_code || v.postalCode),
      venue_country_code: countryCode?.toUpperCase() || null,
      venue_country: optionalText(v.country),
      provider_active: 1,
      event_kind: musicEvent.kind,
      music_qualified: 1,
      music_evidence: musicEvent.evidence,
      billed_artists: musicEvent.billedArtists,
      event_end_date: musicEvent.endDate,
    });
  }
  return out;
}

async function bitDates(name) {
  if (!BIT) return [];
  const enc = encodeURIComponent(name).replace(/%2F/gi, "%252F");
  const data = await getJSON(`https://rest.bandsintown.com/artists/${enc}/events?app_id=${encodeURIComponent(BIT)}&date=upcoming`);
  return bandsintownRows(data, { requestedArtist: name });
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

export async function collectNamedTourProviderResults(providers) {
  const active = (providers || []).filter((provider) => provider && typeof provider.run === "function");
  const settled = await Promise.allSettled(active.map((provider) => provider.run()));
  const normalized = settled.map((result) => {
    if (result.status !== "fulfilled") return { rows: [], complete: false, requestComplete: false };
    if (Array.isArray(result.value)) return { rows: result.value, complete: true, requestComplete: true };
    if (result.value && typeof result.value === "object" && Array.isArray(result.value.rows)) {
      const complete = result.value.complete !== false;
      return {
        rows: result.value.rows,
        complete,
        // A deliberately partial market slice can complete every request while
        // remaining ineligible for stale reconciliation. Legacy collectors that
        // only return complete:false still count as a request failure.
        requestComplete: result.value.requestComplete === true || complete,
      };
    }
    return { rows: [], complete: true, requestComplete: true };
  });
  const useful = normalized.map((result, index) => (
    settled[index].status === "fulfilled"
      && (result.requestComplete || result.rows.length > 0)
  ));
  return {
    rows: normalized.flatMap((result) => result.rows),
    // A partial page with verified rows is useful durable work even though it
    // also remains a failure for retry/reconciliation purposes. An incomplete
    // zero-row response proves nothing and must not suppress total-outage retry.
    successes: useful.filter(Boolean).length,
    failures: settled.filter((result) => result.status === "rejected").length
      + normalized.filter((result, index) => settled[index].status === "fulfilled" && !result.requestComplete).length,
    outcomes: settled.map((result, index) => ({
      source: active[index].source,
      ok: result.status === "fulfilled" && normalized[index].complete,
    })),
  };
}

export function sourcesEligibleForStaleReconciliation(providerStats) {
  return [...(providerStats || new Map())]
    .filter(([, stats]) => stats.successes > 0 && stats.failures === 0)
    .map(([source]) => source);
}

export function reconcileStaleProviderTourDates(database, {
  successfulSources,
  staleBefore,
} = {}) {
  const sources = [...new Set((successfulSources || []).filter((source) => /^(ticketmaster|bandsintown)$/.test(source)))];
  const cutoff = Number(staleBefore);
  if (!Number.isSafeInteger(cutoff) || cutoff < 0 || !sources.length) return 0;
  const deactivate = database.prepare(`UPDATE tour_dates SET provider_active=0
    WHERE owner_id IS NULL AND source=? AND provider_active<>0
      AND COALESCE(last_seen_at,updated_at)<?`);
  let deactivated = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const source of sources) deactivated += Number(deactivate.run(source, cutoff).changes) || 0;
    database.exec("COMMIT");
    return deactivated;
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original provider reconciliation failure */ }
    throw error;
  }
}

export function dedupeTourProviderRows(rows) {
  const byIdentity = new Map();
  for (const row of rows || []) {
    const source = norm(row?.source) || "unknown";
    const providerEventId = optionalText(row?.provider_event_id);
    const stableId = optionalText(row?.id);
    const identity = providerEventId
      ? JSON.stringify(["provider", source, providerEventId])
      : stableId
        ? JSON.stringify(["id", source, stableId])
        : JSON.stringify([
          "composite",
          source,
          ticketmasterArtistIdentity(row?.artist),
          norm(row?.venue),
          optionalText(row?.date),
          optionalText(row?.start_date_time),
          optionalText(row?.start_local_time),
          optionalText(row?.event_name),
          optionalText(row?.ticket_url),
        ]);
    if (!byIdentity.has(identity)) byIdentity.set(identity, row);
  }
  return [...byIdentity.values()];
}

async function fetchDates(name) {
  const result = await collectNamedTourProviderResults([
    KEY ? { source: "ticketmaster", run: () => tmDates(name) } : null,
    BIT ? { source: "bandsintown", run: () => bitDates(name) } : null,
  ]);
  return { ...result, rows: dedupeTourProviderRows(result.rows) };
}

const PROVIDER_TOUR_DATE_UPSERT_SQL = `
  INSERT INTO tour_dates (
    id,artist,artist_key,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at,
    provider_event_id,event_name,tour_name,start_date_time,start_local_time,
    access_start_date_time,access_start_approximate,event_timezone,event_status,
    venue_provider_id,venue_address_line1,venue_address_line2,venue_city,venue_region,
    venue_postal_code,venue_country_code,venue_country,provider_active,last_seen_at,
    event_kind,music_qualified,music_evidence,billed_artists,event_end_date,
    event_image_url,event_image_attribution,event_image_width,event_image_height
  ) VALUES (
    @id,@artist,@artist_key,@venue,@place,@lat,@lng,@date,@ticket_url,@sold_out,@source,@updated_at,
    @provider_event_id,@event_name,@tour_name,@start_date_time,@start_local_time,
    @access_start_date_time,@access_start_approximate,@event_timezone,@event_status,
    @venue_provider_id,@venue_address_line1,@venue_address_line2,@venue_city,@venue_region,
    @venue_postal_code,@venue_country_code,@venue_country,@provider_active,@last_seen_at,
    @event_kind,@music_qualified,@music_evidence,@billed_artists,@event_end_date,
    @event_image_url,@event_image_attribution,@event_image_width,@event_image_height
  )
  ON CONFLICT(id) DO UPDATE SET
    artist=excluded.artist,artist_key=excluded.artist_key,venue=excluded.venue,place=excluded.place,
    lat=excluded.lat,lng=excluded.lng,date=excluded.date,ticket_url=excluded.ticket_url,
    sold_out=excluded.sold_out,source=excluded.source,
    updated_at=CASE WHEN
      excluded.artist IS NOT tour_dates.artist OR excluded.artist_key IS NOT tour_dates.artist_key OR excluded.venue IS NOT tour_dates.venue
      OR excluded.place IS NOT tour_dates.place OR excluded.lat IS NOT tour_dates.lat
      OR excluded.lng IS NOT tour_dates.lng OR excluded.date IS NOT tour_dates.date
      OR excluded.ticket_url IS NOT tour_dates.ticket_url OR excluded.sold_out IS NOT tour_dates.sold_out
      OR excluded.source IS NOT tour_dates.source OR excluded.provider_active IS NOT tour_dates.provider_active
      OR COALESCE(excluded.provider_event_id,tour_dates.provider_event_id) IS NOT tour_dates.provider_event_id
      OR COALESCE(excluded.event_name,tour_dates.event_name) IS NOT tour_dates.event_name
      OR (CASE WHEN excluded.event_name IS NOT NULL THEN excluded.tour_name ELSE tour_dates.tour_name END) IS NOT tour_dates.tour_name
      OR COALESCE(excluded.start_date_time,tour_dates.start_date_time) IS NOT tour_dates.start_date_time
      OR COALESCE(excluded.start_local_time,tour_dates.start_local_time) IS NOT tour_dates.start_local_time
      OR COALESCE(excluded.access_start_date_time,tour_dates.access_start_date_time) IS NOT tour_dates.access_start_date_time
      OR COALESCE(excluded.access_start_approximate,tour_dates.access_start_approximate) IS NOT tour_dates.access_start_approximate
      OR COALESCE(excluded.event_timezone,tour_dates.event_timezone) IS NOT tour_dates.event_timezone
      OR COALESCE(excluded.event_status,tour_dates.event_status) IS NOT tour_dates.event_status
      OR COALESCE(excluded.venue_provider_id,tour_dates.venue_provider_id) IS NOT tour_dates.venue_provider_id
      OR COALESCE(excluded.venue_address_line1,tour_dates.venue_address_line1) IS NOT tour_dates.venue_address_line1
      OR COALESCE(excluded.venue_address_line2,tour_dates.venue_address_line2) IS NOT tour_dates.venue_address_line2
      OR COALESCE(excluded.venue_city,tour_dates.venue_city) IS NOT tour_dates.venue_city
      OR COALESCE(excluded.venue_region,tour_dates.venue_region) IS NOT tour_dates.venue_region
      OR COALESCE(excluded.venue_postal_code,tour_dates.venue_postal_code) IS NOT tour_dates.venue_postal_code
      OR COALESCE(excluded.venue_country_code,tour_dates.venue_country_code) IS NOT tour_dates.venue_country_code
      OR COALESCE(excluded.venue_country,tour_dates.venue_country) IS NOT tour_dates.venue_country
      OR excluded.event_kind IS NOT tour_dates.event_kind
      OR excluded.music_qualified IS NOT tour_dates.music_qualified
      OR excluded.music_evidence IS NOT tour_dates.music_evidence
      OR excluded.billed_artists IS NOT tour_dates.billed_artists
      OR excluded.event_end_date IS NOT tour_dates.event_end_date
      OR excluded.event_image_url IS NOT tour_dates.event_image_url
      OR excluded.event_image_attribution IS NOT tour_dates.event_image_attribution
      OR excluded.event_image_width IS NOT tour_dates.event_image_width
      OR excluded.event_image_height IS NOT tour_dates.event_image_height
      THEN excluded.updated_at ELSE tour_dates.updated_at END,
    provider_event_id=COALESCE(excluded.provider_event_id,tour_dates.provider_event_id),
    event_name=COALESCE(excluded.event_name,tour_dates.event_name),
    tour_name=CASE WHEN excluded.event_name IS NOT NULL THEN excluded.tour_name ELSE tour_dates.tour_name END,
    start_date_time=COALESCE(excluded.start_date_time,tour_dates.start_date_time),
    start_local_time=COALESCE(excluded.start_local_time,tour_dates.start_local_time),
    access_start_date_time=COALESCE(excluded.access_start_date_time,tour_dates.access_start_date_time),
    access_start_approximate=COALESCE(excluded.access_start_approximate,tour_dates.access_start_approximate),
    event_timezone=COALESCE(excluded.event_timezone,tour_dates.event_timezone),
    event_status=COALESCE(excluded.event_status,tour_dates.event_status),
    venue_provider_id=COALESCE(excluded.venue_provider_id,tour_dates.venue_provider_id),
    venue_address_line1=COALESCE(excluded.venue_address_line1,tour_dates.venue_address_line1),
    venue_address_line2=COALESCE(excluded.venue_address_line2,tour_dates.venue_address_line2),
    venue_city=COALESCE(excluded.venue_city,tour_dates.venue_city),
    venue_region=COALESCE(excluded.venue_region,tour_dates.venue_region),
    venue_postal_code=COALESCE(excluded.venue_postal_code,tour_dates.venue_postal_code),
    venue_country_code=COALESCE(excluded.venue_country_code,tour_dates.venue_country_code),
    venue_country=COALESCE(excluded.venue_country,tour_dates.venue_country),
    event_kind=excluded.event_kind,music_qualified=excluded.music_qualified,
    music_evidence=excluded.music_evidence,billed_artists=excluded.billed_artists,
    event_end_date=excluded.event_end_date,
    event_image_url=excluded.event_image_url,
    event_image_attribution=excluded.event_image_attribution,
    event_image_width=excluded.event_image_width,
    event_image_height=excluded.event_image_height,
    provider_active=excluded.provider_active,last_seen_at=excluded.last_seen_at
  WHERE tour_dates.owner_id IS NULL`;

function providerTourDateWrite(row, seenAt, artistKey) {
  return {
    id: row.id,
    artist: row.artist,
    artist_key: artistKey,
    venue: row.venue ?? null,
    place: row.place ?? null,
    lat: optionalCoordinate(row.lat),
    lng: optionalCoordinate(row.lng),
    date: row.date ?? null,
    ticket_url: row.ticket_url ?? null,
    sold_out: row.sold_out ? 1 : 0,
    source: row.source ?? null,
    updated_at: seenAt,
    provider_event_id: row.provider_event_id ?? null,
    event_name: row.event_name ?? null,
    tour_name: deriveTourNameFromEventTitle({
      eventName: row.event_name,
      artist: row.artist,
      eventKind: row.event_kind || "concert",
    }),
    start_date_time: row.start_date_time ?? null,
    start_local_time: row.start_local_time ?? null,
    access_start_date_time: row.access_start_date_time ?? null,
    access_start_approximate: row.access_start_approximate == null
      ? null
      : (row.access_start_approximate ? 1 : 0),
    event_timezone: row.event_timezone ?? null,
    event_status: row.event_status ?? null,
    venue_provider_id: row.venue_provider_id ?? null,
    venue_address_line1: row.venue_address_line1 ?? null,
    venue_address_line2: row.venue_address_line2 ?? null,
    venue_city: row.venue_city ?? null,
    venue_region: row.venue_region ?? null,
    venue_postal_code: row.venue_postal_code ?? null,
    venue_country_code: row.venue_country_code ?? null,
    venue_country: row.venue_country ?? null,
    provider_active: 1,
    last_seen_at: seenAt,
    event_kind: row.event_kind || "concert",
    music_qualified: row.music_qualified === 1 ? 1 : 0,
    music_evidence: row.music_evidence ?? null,
    billed_artists: JSON.stringify(Array.isArray(row.billed_artists) ? row.billed_artists.slice(0, 20) : []),
    event_end_date: row.event_end_date ?? null,
    event_image_url: row.event_image_url ?? null,
    event_image_attribution: row.event_image_attribution ?? null,
    event_image_width: row.event_image_width ?? null,
    event_image_height: row.event_image_height ?? null,
  };
}

export function reconcileStaleProviderTourDatesForArtists(database, {
  sourceArtists,
  staleBefore,
} = {}) {
  const cutoff = Number(staleBefore);
  if (!Number.isSafeInteger(cutoff) || cutoff < 0) return 0;
  const entries = sourceArtists instanceof Map
    ? [...sourceArtists]
    : Object.entries(sourceArtists || {});
  const scopes = entries
    .filter(([source]) => /^(ticketmaster|bandsintown)$/.test(source))
    .map(([source, artists]) => [source, [...new Set([...(artists || [])].map(norm).filter(Boolean))].slice(0, 1000)])
    .filter(([, artists]) => artists.length);
  if (!scopes.length) return 0;
  const deactivate = database.prepare(`UPDATE tour_dates SET provider_active=0
    WHERE owner_id IS NULL AND source=? AND provider_active<>0
      AND lower(trim(artist))=? AND COALESCE(last_seen_at,updated_at)<?`);
  let deactivated = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [source, artists] of scopes) {
      for (const artist of artists) deactivated += Number(deactivate.run(source, artist, cutoff).changes) || 0;
    }
    database.exec("COMMIT");
    return deactivated;
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original scoped provider reconciliation failure */ }
    throw error;
  }
}

export function upsertProviderTourDateRows(database, rows, { seenAt = Date.now() } = {}) {
  const timestamp = Number(seenAt);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("seenAt must be a non-negative integer");
  const statement = database.prepare(PROVIDER_TOUR_DATE_UPSERT_SQL);
  const artistMatches = database.prepare("SELECT norm FROM artists WHERE lower(trim(name))=lower(trim(?)) ORDER BY norm LIMIT 2");
  let changed = 0;
  for (const row of rows || []) {
    const matches = artistMatches.all(row?.artist || "");
    const artistKey = matches.length === 1 ? matches[0].norm : null;
    changed += Number(statement.run(providerTourDateWrite(row, timestamp, artistKey)).changes) || 0;
  }
  return changed;
}

export function persistTicketmasterMarketResult(database, {
  market,
  result,
  seenAt = Date.now(),
} = {}) {
  if (!database?.exec || !database?.prepare) throw new TypeError("market result persistence requires a database");
  const providerResult = result && typeof result === "object" ? result : { rows: [] };
  let changed = 0;
  let stateAdvanced = false;
  database.exec("BEGIN IMMEDIATE");
  try {
    changed = upsertProviderTourDateRows(database, providerResult.rows, { seenAt });
    // Empty successful windows still prove date coverage. Advance the cursor in
    // the same transaction as row writes so a failed upsert can never skip a
    // market window. Failed/partial HTTP work keeps its useful rows but retries
    // the same coverage cursor later.
    if (providerResult.requestComplete === true && providerResult.nextState) {
      stateAdvanced = writeTicketmasterMarketCoverageState(database, market, providerResult.nextState);
    }
    database.exec("COMMIT");
    return { changed, stateAdvanced };
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original market persistence failure */ }
    throw error;
  }
}

let running = false;
async function refresh() {
  if (running || (!KEY && !BIT)) return;
  running = true;
  const t0 = Date.now();
  try {
    const cat = JSON.parse(readFileSync(CATALOG, "utf8"));
    const artistSelection = selectTourDateRefreshArtists(db, {
      limit: LIMIT,
      rotationSize: ARTIST_ROTATION_SIZE,
      cursor: storedArtistCursor(),
      fallbackArtists: Object.values(cat.artists || {}),
    });
    const artists = artistSelection.artists;
    const countryBatch = KEY
      ? ticketmasterCountryRotation(COUNTRY_CODES, storedCountryCursor(), COUNTRY_BATCH_SIZE)
      : { countries: [], nextCursor: 0 };
    let total = 0, providerSuccesses = 0, providerFailures = 0;
    const successfulArtistScopes = new Map();
    const recordOutcomes = (outcomes, artistName = null) => {
      for (const outcome of outcomes || []) {
        // Bandsintown's exact-artist endpoint returns the complete upcoming
        // list, so a successful call can safely reconcile only that artist.
        // Ticketmaster artist pages and market partitions are bounded and must
        // never authorize source-wide cleanup.
        if (!artistName || !outcome.ok || outcome.source !== "bandsintown") continue;
        const artists = successfulArtistScopes.get(outcome.source) || new Set();
        artists.add(artistName);
        successfulArtistScopes.set(outcome.source, artists);
      }
    };
    for (const a of artists) {
      try {
        const result = await fetchDates(a.name);
        providerSuccesses += result.successes;
        providerFailures += result.failures;
        recordOutcomes(result.outcomes, a.name);
        const now = Date.now();
        db.exec("BEGIN");
        upsertProviderTourDateRows(db, result.rows, { seenAt: now });
        db.exec("COMMIT");
        total += result.rows.length;
      } catch (e) {
        try { db.exec("ROLLBACK"); }
        catch { /* architecture: allow-empty-catch -- preserve the original artist-ingest write failure */ }
        throw e;
      }
      await sleep(TM_REQUEST_DELAY_MS); // stay below provider rate limits
    }
    const cities = db.prepare(`SELECT home_city city, COUNT(*) members FROM users
      WHERE home_city IS NOT NULL AND trim(home_city) <> ''
      GROUP BY lower(trim(home_city)) ORDER BY members DESC LIMIT ?`).all(CITY_LIMIT);
    for (const { city } of cities) {
      try {
        let marketResult = null;
        const result = await collectNamedTourProviderResults([KEY ? {
          source: "ticketmaster",
          run: async () => {
            marketResult = await tmCityDates(city);
            return marketResult;
          },
        } : null]);
        providerSuccesses += result.successes;
        providerFailures += result.failures;
        recordOutcomes(result.outcomes);
        const now = Date.now();
        if (marketResult) persistTicketmasterMarketResult(db, {
          market: { city },
          result: marketResult,
          seenAt: now,
        });
        total += result.rows.length;
      } catch (e) {
        try { db.exec("ROLLBACK"); }
        catch { /* architecture: allow-empty-catch -- preserve the original city-ingest write failure */ }
        throw e;
      }
      await sleep(TM_REQUEST_DELAY_MS);
    }
    for (const countryCode of countryBatch.countries) {
      try {
        let marketResult = null;
        const result = await collectNamedTourProviderResults([
          {
            source: "ticketmaster",
            run: async () => {
              marketResult = await tmCountryDates(countryCode);
              return marketResult;
            },
          },
        ]);
        providerSuccesses += result.successes;
        providerFailures += result.failures;
        recordOutcomes(result.outcomes);
        const now = Date.now();
        if (marketResult) persistTicketmasterMarketResult(db, {
          market: { countryCode },
          result: marketResult,
          seenAt: now,
        });
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
    // A rotating artist lane can never prove source-wide completeness. Reconcile
    // only exact Bandsintown artists whose complete request succeeded this run;
    // provider and member rows outside that scope remain untouched.
    reconcileStaleProviderTourDatesForArtists(db, {
      sourceArtists: successfulArtistScopes,
      staleBefore: Date.now() - 30 * DAY,
    });
    // A partial provider outage must not turn Render restarts into an immediate
    // replay of the entire worldwide sweep. Successful rows are durable and
    // stale deactivation is isolated to exact successful artist scopes, so any
    // useful provider work advances the normal interval. A total outage still
    // throws above and intentionally leaves the refresh due.
    markRefreshComplete(Date.now(), artistSelection.nextCursor);
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
      if (!shouldRefreshTourDateIngestion({
        lastRefreshAt: storedLastRefreshAt(),
        storedRevision: storedIngestionRevision(),
      })) return;
      await refresh();
    }));
  };
  // Let health checks and real traffic win the cold-start window. The freshness
  // read itself stays inside the safe job boundary in case SQLite is transiently
  // unavailable during maintenance.
  setTimeout(triggerRefresh, 30_000).unref();
  setInterval(triggerRefresh, REFRESH_H * 3600 * 1000).unref();
}
