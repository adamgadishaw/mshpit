import { genreFieldsForClaim, storedClaims } from "../../../src/domain/genre.mjs";
import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { readCatalogKnowledgeControl } from "../../catalogKnowledgeControl.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { ARTIST_LINK_KINDS, fetchTicketmasterProfile, ticketmasterGenreLabel } from "./ticketmasterProfiles.js";
import { createWikidataIdentityBridge } from "./wikidataIdentityBridge.js";

// Web profile agents: fill artist and venue pages from records the web already
// publishes about them, without MusicBrainz searches and without AI writing.
//
// Performers: the Ticketmaster attraction behind every imported show gives
// official links, a genre, and often a MusicBrainz ID or Wikipedia page. An ID
// confirmed by Wikidata is stored on the artist, which lets the existing
// Wikipedia biography worker fill the page. Venues: the Ticketmaster venue
// record gives box office, parking, accessibility and entry rules.
//
// Everything is additive. An artist's existing ID, biography, genre decided
// by staff, or a claimed page is never changed.

const BUDGET_KEY = "provider-profiles:v1:budget";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LEASE_MS = 15 * MINUTE;
const REFRESH_MS = Object.freeze({ found: 30 * DAY, missing: 60 * DAY });
const FAILURE_BACKOFF_MS = Object.freeze([30 * MINUTE, 3 * 60 * MINUTE, 12 * 60 * MINUTE, DAY, 3 * DAY]);
const REQUEST_SPACING_MS = 1_100;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const utcDay = (at) => new Date(at).toISOString().slice(0, 10);

export function providerProfilesConfigured(env = process.env) {
  return !!String(env.TICKETMASTER_KEY || "").trim();
}

export function providerProfileDailyRequests(env = process.env) {
  const value = Number(env.TICKETMASTER_PROFILE_DAILY_REQUESTS);
  // The Discovery API allows 5,000 calls a day, shared with show-date refresh.
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 4_000) : 1_500;
}

export function ensureProviderProfileSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS provider_profiles (
    provider TEXT NOT NULL CHECK(provider='ticketmaster'),
    kind TEXT NOT NULL CHECK(kind IN ('attraction','venue')),
    provider_id TEXT COLLATE BINARY NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 100),
    status TEXT NOT NULL CHECK(status IN ('leased','found','missing','failed')),
    profile TEXT CHECK(profile IS NULL OR length(profile) <= 16000),
    identity_status TEXT CHECK(identity_status IS NULL OR identity_status IN ('applied','confirmed_elsewhere','unconfirmed','conflict','not_needed','none')),
    fetched_at INTEGER,
    next_fetch_at INTEGER NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
    lease_until INTEGER,
    PRIMARY KEY(provider, kind, provider_id)
  );
  CREATE INDEX IF NOT EXISTS idx_provider_profiles_due ON provider_profiles(kind, next_fetch_at);`);
}

function readBudget(database, at) {
  let stored = null;
  try { stored = JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?").get(BUDGET_KEY)?.value || "null"); }
  catch { stored = null; }
  const base = { version: 1, utcDay: utcDay(at), requests: 0, artists: 0, venues: 0, idsAdded: 0, genresAdded: 0,
    lastRunAt: stored?.lastRunAt ?? null, lastError: stored?.lastError ?? null };
  if (!stored || stored.version !== 1 || stored.utcDay !== base.utcDay) return base;
  const count = (value) => Math.max(0, Number(value) || 0);
  return { ...base, requests: count(stored.requests), artists: count(stored.artists), venues: count(stored.venues),
    idsAdded: count(stored.idsAdded), genresAdded: count(stored.genresAdded) };
}

function saveBudget(database, budget) {
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(BUDGET_KEY, JSON.stringify(budget));
}

// Performers seen most recently in shows first, and among them the ones whose
// pages are still empty.
export function nextAttractionForProfile(database, { at = Date.now() } = {}) {
  return database.prepare(`SELECT m.provider_id id,m.artist_key,a.name,a.mbid FROM provider_artist_identities m
      JOIN artists a ON a.norm=m.artist_key
      LEFT JOIN provider_profiles p ON p.provider='ticketmaster' AND p.kind='attraction' AND p.provider_id=m.provider_id
      WHERE m.provider='ticketmaster'
        AND (p.provider_id IS NULL OR (p.next_fetch_at<=? AND (p.status<>'leased' OR COALESCE(p.lease_until,0)<=?)))
      ORDER BY (a.bio IS NULL OR trim(a.bio)='') DESC, m.last_seen_at DESC, m.provider_id LIMIT 1`).get(at, at) || null;
}

// Venues with the most shows on file first.
export function nextVenueForProfile(database, { at = Date.now() } = {}) {
  const rows = database.prepare(`SELECT venue_provider_id id,MIN(venue) name,COUNT(*) shows FROM tour_dates
      WHERE source='ticketmaster' AND venue_provider_id IS NOT NULL AND trim(venue_provider_id)<>''
      GROUP BY venue_provider_id ORDER BY shows DESC, venue_provider_id LIMIT 3000`).all();
  const due = database.prepare(`SELECT 1 FROM provider_profiles WHERE provider='ticketmaster' AND kind='venue' AND provider_id=?
      AND (next_fetch_at>? OR (status='leased' AND COALESCE(lease_until,0)>?))`);
  for (const row of rows) {
    if (/^[A-Za-z0-9_-]{1,100}$/u.test(row.id) && !due.get(row.id, at, at)) return { id: row.id, name: row.name };
  }
  return null;
}

function lease(database, kind, id, at) {
  database.prepare(`INSERT INTO provider_profiles (provider,kind,provider_id,status,next_fetch_at,lease_until)
      VALUES ('ticketmaster',?,?,'leased',?,?)
    ON CONFLICT(provider,kind,provider_id) DO UPDATE SET status='leased',lease_until=excluded.lease_until`)
    .run(kind, id, at + LEASE_MS, at + LEASE_MS);
}

function settle(database, kind, id, { status, profile = null, identityStatus = null, at }) {
  const row = database.prepare("SELECT failures,profile FROM provider_profiles WHERE provider='ticketmaster' AND kind=? AND provider_id=?")
    .get(kind, id);
  const failures = status === "failed" ? (Number(row?.failures) || 0) + 1 : 0;
  const nextAt = status === "failed"
    ? at + FAILURE_BACKOFF_MS[Math.min(FAILURE_BACKOFF_MS.length - 1, failures - 1)]
    : at + (REFRESH_MS[status] || REFRESH_MS.missing);
  // A failed refresh keeps the last good record visible.
  const keep = status === "failed" && row?.profile;
  database.prepare(`UPDATE provider_profiles SET status=?,profile=?,identity_status=COALESCE(?,identity_status),
      fetched_at=CASE WHEN ?='failed' THEN fetched_at ELSE ? END,next_fetch_at=?,failures=?,lease_until=NULL
    WHERE provider='ticketmaster' AND kind=? AND provider_id=?`)
    .run(keep ? "found" : status, keep ? row.profile : (profile ? JSON.stringify(profile) : null), identityStatus,
      status, at, nextAt, failures, kind, id);
}

function parseData(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

// Stores a confirmed MusicBrainz ID and Ticketmaster's genre on the artist,
// only where the artist has none. Returns what changed.
function applyAttraction(database, artistKey, profile, identity, at) {
  const artist = database.prepare("SELECT norm,mbid,genre,data FROM artists WHERE norm=?").get(artistKey);
  const outcome = { idAdded: false, genreAdded: false };
  if (!artist) return outcome;
  const data = parseData(artist.data);
  if (data === null) return outcome;
  let nextData = data;
  let nextGenre = artist.genre;
  let nextMbid = artist.mbid;
  if (identity?.mbid && MBID.test(identity.mbid) && !String(artist.mbid || "").trim()) {
    const taken = database.prepare("SELECT 1 FROM artists WHERE lower(mbid)=? AND norm<>? LIMIT 1").get(identity.mbid, artistKey);
    if (!taken) {
      nextMbid = identity.mbid;
      nextData = { ...nextData, mbidEvidence: { provider: "ticketmaster", attractionId: profile.id, via: identity.via,
        wikidataId: identity.wikidataId, at } };
      outcome.idAdded = true;
    }
  }
  const genre = ticketmasterGenreLabel(profile.genre);
  if (genre) {
    const before = storedClaims(nextData, nextGenre).find((claim) => claim.source === "ticketmaster")?.value;
    if (before !== genre) {
      const fields = genreFieldsForClaim(nextData, nextGenre, genre, "ticketmaster", at);
      nextData = { ...nextData, genreClaims: fields.genreClaims };
      delete nextData.genreRecord;
      if (fields.genre !== nextGenre) outcome.genreAdded = true;
      nextGenre = fields.genre;
    }
  }
  if (nextData !== data || nextGenre !== artist.genre || nextMbid !== artist.mbid) {
    database.prepare(`UPDATE artists SET mbid=?,genre=?,data=?,updated_at=? WHERE norm=?
        AND COALESCE(mbid,'')=COALESCE(?,'')`)
      .run(nextMbid || null, nextGenre || null, JSON.stringify(nextData), at, artistKey, artist.mbid || null);
  }
  return outcome;
}

// Runs one pass: up to `maxItems` Ticketmaster records, alternating performers
// and venues, inside the daily request allowance.
export async function runProviderProfilePass({
  database,
  env = process.env,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  signal,
  maxItems = 12,
  fetchProfile = fetchTicketmasterProfile,
  confirmIdentity = createWikidataIdentityBridge({ fetchImpl }),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const outcome = { artists: 0, venues: 0, idsAdded: 0, genresAdded: 0, stopped: null };
  if (!providerProfilesConfigured(env)) return { ...outcome, stopped: "not_configured" };
  if (readCatalogKnowledgeControl(database, { env, at: now() })?.mode === "paused") return { ...outcome, stopped: "paused" };
  const cap = providerProfileDailyRequests(env);
  const apiKey = String(env.TICKETMASTER_KEY).trim();
  for (let index = 0; index < maxItems; index += 1) {
    if (signal?.aborted) return { ...outcome, stopped: "aborted" };
    const at = now();
    let budget = readBudget(database, at);
    if (budget.requests >= cap) return { ...outcome, stopped: "daily_budget" };
    const order = index % 2 === 0 ? ["attraction", "venue"] : ["venue", "attraction"];
    let kind = null;
    let target = null;
    for (const candidate of order) {
      target = candidate === "attraction" ? nextAttractionForProfile(database, { at }) : nextVenueForProfile(database, { at });
      if (target) { kind = candidate; break; }
    }
    if (!target) return { ...outcome, stopped: "nothing_due" };
    lease(database, kind, target.id, at);
    saveBudget(database, { ...budget, requests: budget.requests + 1 });
    if (index > 0) await wait(REQUEST_SPACING_MS);
    let profile;
    try {
      profile = await fetchProfile(kind === "attraction" ? "attractions" : "venues", target.id, { apiKey, fetchImpl, signal });
    } catch (error) {
      settle(database, kind, target.id, { status: "failed", at: now() });
      const code = typeof error?.code === "string" ? error.code : "error";
      budget = readBudget(database, now());
      saveBudget(database, { ...budget, lastRunAt: now(), lastError: { code, at: now() } });
      if (["auth", "rate_limited", "not_configured"].includes(code) || signal?.aborted) return { ...outcome, stopped: code };
      continue;
    }
    if (!profile) {
      settle(database, kind, target.id, { status: "missing", at: now() });
      continue;
    }
    let identityStatus = null;
    let applied = { idAdded: false, genreAdded: false };
    if (kind === "attraction") {
      let identity = null;
      if (String(target.mbid || "").trim()) identityStatus = "not_needed";
      else if (profile.mbid || profile.links.wiki) {
        try {
          identity = await confirmIdentity({ name: target.name, mbid: profile.mbid, wikipediaUrl: profile.links.wiki, signal });
          identityStatus = identity ? "applied" : "unconfirmed";
        } catch {
          // Wikidata is a second source; its outage only delays the ID.
          identityStatus = null;
        }
      } else identityStatus = "none";
      applied = applyAttraction(database, target.artist_key, profile, identity, now());
      if (identity && !applied.idAdded) identityStatus = "conflict";
      outcome.artists += 1;
      outcome.idsAdded += applied.idAdded ? 1 : 0;
      outcome.genresAdded += applied.genreAdded ? 1 : 0;
    } else {
      outcome.venues += 1;
    }
    settle(database, kind, target.id, { status: "found", profile, identityStatus, at: now() });
    budget = readBudget(database, now());
    saveBudget(database, {
      ...budget,
      artists: budget.artists + (kind === "attraction" ? 1 : 0),
      venues: budget.venues + (kind === "venue" ? 1 : 0),
      idsAdded: budget.idsAdded + (applied.idAdded ? 1 : 0),
      genresAdded: budget.genresAdded + (applied.genreAdded ? 1 : 0),
      lastRunAt: now(),
    });
  }
  return outcome;
}

// Official links and genre for one artist page.
export function readArtistProviderProfile(database, artistKey) {
  const row = database.prepare(`SELECT p.profile,p.fetched_at FROM provider_artist_identities m
      JOIN provider_profiles p ON p.provider='ticketmaster' AND p.kind='attraction' AND p.provider_id=m.provider_id
      WHERE m.provider='ticketmaster' AND m.artist_key=? AND p.status='found' AND p.profile IS NOT NULL
      ORDER BY m.last_seen_at DESC LIMIT 1`).get(String(artistKey || ""));
  const profile = row ? parseData(row.profile) : null;
  if (!profile) return null;
  const links = Object.entries(ARTIST_LINK_KINDS)
    .filter(([kind]) => typeof profile.links?.[kind] === "string")
    .map(([kind, rule]) => ({ kind, label: rule.label, url: profile.links[kind] }));
  const genre = ticketmasterGenreLabel(profile.genre);
  if (!links.length && !genre) return null;
  return { links, genre, source: { name: "Ticketmaster", url: profile.pageUrl || null }, checkedAt: row.fetched_at ?? null };
}

// Visitor details for one venue page. The provider id must belong to a show
// at a venue with this name, so a page cannot display another room's record.
// Without an id (a page opened straight from its link) the name and city must
// lead to exactly one Ticketmaster venue.
export function readVenueProviderProfile(database, { venueKey, providerVenueId = null, city = null }) {
  const key = canonicalVenueKey(venueKey);
  if (!key) return null;
  let id = String(providerVenueId || "");
  if (!id) {
    const wantedCity = String(city || "").trim().toLowerCase();
    const ids = new Set(database.prepare(`SELECT DISTINCT venue,venue_city,venue_provider_id FROM tour_dates
        WHERE source='ticketmaster' AND venue_provider_id IS NOT NULL AND lower(trim(venue))=? LIMIT 50`).all(key)
      .filter((row) => canonicalVenueKey(row.venue) === key
        && (!wantedCity || String(row.venue_city || "").trim().toLowerCase() === wantedCity))
      .map((row) => row.venue_provider_id));
    if (ids.size !== 1) return null;
    id = [...ids][0];
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(id)) return null;
  const names = database.prepare(`SELECT DISTINCT venue FROM tour_dates WHERE source='ticketmaster' AND venue_provider_id=? LIMIT 20`).all(id);
  if (!names.some((row) => canonicalVenueKey(row.venue) === key)) return null;
  const row = database.prepare(`SELECT profile,fetched_at FROM provider_profiles
      WHERE provider='ticketmaster' AND kind='venue' AND provider_id=? AND status='found' AND profile IS NOT NULL`).get(id);
  const profile = row ? parseData(row.profile) : null;
  if (!profile || !Object.keys(profile.details || {}).length) return null;
  return {
    details: profile.details,
    address: profile.address || null,
    source: { name: "Ticketmaster", url: profile.pageUrl || null },
    checkedAt: row.fetched_at ?? null,
  };
}

export function collectProviderProfileStatus(database, { env = process.env, at = Date.now() } = {}) {
  const budget = readBudget(database, at);
  const counts = Object.fromEntries(database.prepare(`SELECT kind||':'||status k,COUNT(*) c FROM provider_profiles GROUP BY k`)
    .all().map((row) => [row.k, row.c]));
  const identities = Object.fromEntries(database.prepare(`SELECT identity_status k,COUNT(*) c FROM provider_profiles
      WHERE kind='attraction' AND identity_status IS NOT NULL GROUP BY identity_status`).all().map((row) => [row.k, row.c]));
  const count = (key) => Number(counts[key] || 0);
  return {
    configured: providerProfilesConfigured(env),
    enabled: providerProfilesConfigured(env) && backgroundJobEnabled(env, "PROVIDER_PROFILES_ENABLED"),
    dailyRequests: providerProfileDailyRequests(env),
    today: { requests: budget.requests, artists: budget.artists, venues: budget.venues,
      idsAdded: budget.idsAdded, genresAdded: budget.genresAdded },
    lastRunAt: budget.lastRunAt,
    lastError: budget.lastError,
    artists: { found: count("attraction:found"), missing: count("attraction:missing"), failed: count("attraction:failed"),
      idsAdded: Number(identities.applied || 0), idsUnconfirmed: Number(identities.unconfirmed || 0) },
    venues: { found: count("venue:found"), missing: count("venue:missing"), failed: count("venue:failed") },
  };
}

export function startProviderProfileScheduler({ database, env = process.env, now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  ensureProviderProfileSchema(database);
  if (!providerProfilesConfigured(env) || !backgroundJobEnabled(env, "PROVIDER_PROFILES_ENABLED")) return null;
  const confirmIdentity = createWikidataIdentityBridge({ fetchImpl });
  return startPeriodicJob({
    initialDelayMs: 4 * MINUTE,
    intervalMs: 10 * MINUTE,
    run: async ({ signal }) => {
      const result = await runProviderProfilePass({ database, env, now, fetchImpl, signal, confirmIdentity });
      if (result.artists || result.venues || !["nothing_due", "daily_budget", "paused"].includes(result.stopped)) {
        console.log(`[web-profiles] artists=${result.artists} venues=${result.venues} idsAdded=${result.idsAdded} genresAdded=${result.genresAdded} stopped=${result.stopped || "pass_done"}`);
      }
      return true;
    },
    report: (error) => console.error(`[web-profiles] pass failed safely: ${privateErrorLabel(error)}`),
  });
}
