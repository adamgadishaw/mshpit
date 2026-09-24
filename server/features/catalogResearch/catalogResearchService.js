import { randomUUID } from "node:crypto";

import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { readCatalogKnowledgeControl } from "../../catalogKnowledgeControl.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { publicCatalogResearch, validateCatalogResearchFindings } from "./catalogResearchFindings.js";
import { catalogResearchModel, researchCatalogSubject } from "./catalogResearchProvider.js";

// The research agent fills the artist and venue pages the catalogue sources
// leave empty. It works through the pages fans are most likely to open first
// (acts and rooms with shows on file), one at a time, inside a daily dollar
// cap, and only ever adds a sourced summary and facts next to what a page
// already has. It never edits a biography, a claimed artist page or staff
// facts, and a staff member can hide any result.

const BUDGET_KEY = "catalog-research:v1:budget";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LEASE_MS = 20 * MINUTE;
const REFRESH_MS = Object.freeze({ found: 180 * DAY, not_found: 60 * DAY, unsure: 90 * DAY });
const FAILURE_BACKOFF_MS = Object.freeze([60 * MINUTE, 6 * 60 * MINUTE, DAY, 3 * DAY, 7 * DAY]);
// Held back from the cap before each run, so one run cannot overshoot it much.
const RUN_RESERVE_MICRO_USD = 200_000;
const STATUSES = new Set(["leased", "found", "not_found", "unsure", "failed", "hidden"]);

const utcDay = (at) => new Date(at).toISOString().slice(0, 10);
const text = (value, max = 200) => typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";

export function catalogResearchConfigured(env = process.env) {
  return !!String(env.ANTHROPIC_API_KEY || "").trim();
}

export function catalogResearchDailyBudgetMicroUsd(env = process.env) {
  const usd = Number(env.CATALOG_RESEARCH_DAILY_USD);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? Math.min(usd, 500) : 5) * 1_000_000);
}

export function ensureCatalogResearchSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS catalog_research (
    entity_type TEXT NOT NULL CHECK(entity_type IN ('artist','venue')),
    entity_key TEXT NOT NULL CHECK(length(entity_key) BETWEEN 1 AND 600),
    identity TEXT NOT NULL CHECK(length(identity) <= 4000),
    status TEXT NOT NULL CHECK(status IN ('leased','found','not_found','unsure','failed','hidden')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
    researched_at INTEGER,
    next_attempt_at INTEGER NOT NULL,
    model TEXT,
    cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK(cost_micro_usd >= 0),
    findings TEXT CHECK(findings IS NULL OR length(findings) <= 20000),
    last_reason TEXT,
    claim_token TEXT,
    PRIMARY KEY(entity_type, entity_key)
  );
  CREATE INDEX IF NOT EXISTS idx_catalog_research_due ON catalog_research(entity_type, next_attempt_at);`);
}

function readBudget(database, at) {
  let stored = null;
  try { stored = JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?").get(BUDGET_KEY)?.value || "null"); }
  catch { stored = null; }
  const today = utcDay(at);
  const base = { version: 1, utcDay: today, spentMicroUsd: 0, runs: 0, published: 0, lastRunAt: null, lastError: null };
  if (!stored || stored.version !== 1) return base;
  const lastError = stored.lastError && typeof stored.lastError === "object" ? stored.lastError : null;
  if (stored.utcDay !== today) return { ...base, lastRunAt: stored.lastRunAt ?? null, lastError };
  return {
    ...base,
    spentMicroUsd: Math.max(0, Number(stored.spentMicroUsd) || 0),
    runs: Math.max(0, Number(stored.runs) || 0),
    published: Math.max(0, Number(stored.published) || 0),
    lastRunAt: stored.lastRunAt ?? null,
    lastError,
  };
}

function saveBudget(database, budget) {
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(BUDGET_KEY, JSON.stringify(budget));
}

function dueRow(database, type, key, at) {
  const row = database.prepare("SELECT status,next_attempt_at FROM catalog_research WHERE entity_type=? AND entity_key=?").get(type, key);
  return !row || (row.status !== "hidden" && Number(row.next_attempt_at) <= at);
}

function artistShows(database, artistKey) {
  return database.prepare(`SELECT venue,venue_city,venue_country_code FROM tour_dates
    WHERE artist_key=? AND owner_id IS NULL AND venue IS NOT NULL ORDER BY date LIMIT 3`).all(artistKey)
    .map((row) => [text(row.venue, 80), text(row.venue_city, 60), text(row.venue_country_code, 8)].filter(Boolean).join(", "));
}

function artistSubject(database, row) {
  return {
    type: "artist",
    key: row.norm,
    name: text(row.name, 160),
    mbid: /^[0-9a-f-]{36}$/iu.test(String(row.mbid || "")) ? String(row.mbid).toLowerCase() : null,
    genre: text(row.genre, 60) || null,
    country: text(row.country, 60) || null,
    shows: artistShows(database, row.norm),
  };
}

// Artists with shows on file first (fans open those pages from the calendar),
// then everyone else by popularity. Only pages with no biography, no claimed
// owner and no staff-written profile text are eligible.
const ARTIST_ELIGIBLE = `(a.bio IS NULL OR trim(a.bio)='')
  AND NOT EXISTS (SELECT 1 FROM artist_profiles p WHERE p.artist_key=a.norm AND p.removed=0
    AND (p.owner_id IS NOT NULL OR (p.bio IS NOT NULL AND trim(p.bio)<>'')))
  AND NOT EXISTS (SELECT 1 FROM catalog_research r WHERE r.entity_type='artist' AND r.entity_key=a.norm
    AND (r.status='hidden' OR r.next_attempt_at>?))`;

export function nextArtistResearchSubject(database, { at = Date.now() } = {}) {
  const withShows = database.prepare(`SELECT a.norm,a.name,a.mbid,a.genre,a.country FROM
      (SELECT artist_key,COUNT(*) shows FROM tour_dates WHERE artist_key IS NOT NULL AND owner_id IS NULL
        GROUP BY artist_key ORDER BY shows DESC LIMIT 2000) t
      JOIN artists a ON a.norm=t.artist_key
      WHERE ${ARTIST_ELIGIBLE}
      ORDER BY t.shows DESC, a.rank_score DESC, a.norm LIMIT 1`).get(at);
  const row = withShows || database.prepare(`SELECT a.norm,a.name,a.mbid,a.genre,a.country FROM artists a
      WHERE ${ARTIST_ELIGIBLE} ORDER BY a.rank_score DESC, a.norm LIMIT 1`).get(at);
  return row && text(row.name) ? artistSubject(database, row) : null;
}

export function venueResearchKey(name, city, country) {
  const venue = canonicalVenueKey(name);
  if (!venue) return null;
  return [venue, text(city, 80).toLowerCase(), text(country, 8).toLowerCase()].join("|");
}

// Rooms with the most shows on file first. A venue is identified by its name
// and city together, because many cities have a "Fillmore" or a "Paradise".
export function nextVenueResearchSubject(database, { at = Date.now() } = {}) {
  const rows = database.prepare(`SELECT MIN(venue) venue,MIN(venue_city) city,MIN(venue_region) region,
      MIN(venue_country_code) country,MAX(venue_address_line1) address,COUNT(*) shows
    FROM tour_dates WHERE venue IS NOT NULL AND trim(venue)<>'' AND owner_id IS NULL
    GROUP BY lower(trim(venue)),lower(coalesce(venue_city,'')),lower(coalesce(venue_country_code,''))
    ORDER BY shows DESC, lower(trim(MIN(venue))), lower(coalesce(MIN(venue_city),'')) LIMIT 2000`).all();
  for (const row of rows) {
    const key = venueResearchKey(row.venue, row.city, row.country);
    if (!key || !dueRow(database, "venue", key, at)) continue;
    const shows = database.prepare(`SELECT artist FROM tour_dates WHERE lower(trim(venue))=lower(trim(?))
        AND lower(coalesce(venue_city,''))=lower(coalesce(?,'')) AND owner_id IS NULL ORDER BY date LIMIT 3`)
      .all(row.venue, row.city).map((show) => text(show.artist, 80)).filter(Boolean);
    return {
      type: "venue",
      key,
      name: text(row.venue, 160),
      city: text(row.city, 80) || null,
      region: text(row.region, 80) || null,
      country: text(row.country, 8) || null,
      address: text(row.address, 160) || null,
      shows,
    };
  }
  return null;
}

function claimSubject(database, subject, at) {
  const token = randomUUID();
  const identity = JSON.stringify(Object.fromEntries(Object.entries(subject).filter(([key]) => key !== "shows")));
  database.prepare(`INSERT INTO catalog_research (entity_type,entity_key,identity,status,attempts,next_attempt_at,claim_token)
      VALUES (?,?,?,'leased',1,?,?)
    ON CONFLICT(entity_type,entity_key) DO UPDATE SET identity=excluded.identity,status='leased',
      attempts=catalog_research.attempts+1,next_attempt_at=excluded.next_attempt_at,claim_token=excluded.claim_token
    WHERE catalog_research.status<>'hidden'`)
    .run(subject.type, subject.key, identity.slice(0, 4000), at + LEASE_MS, token);
  const row = database.prepare("SELECT claim_token FROM catalog_research WHERE entity_type=? AND entity_key=?").get(subject.type, subject.key);
  return row?.claim_token === token ? token : null;
}

function finishSubject(database, subject, token, { status, findings = null, model = null, costMicroUsd = 0, reason = null, at }) {
  if (!STATUSES.has(status)) throw new TypeError("Unknown research status.");
  const row = database.prepare(`SELECT failures,findings FROM catalog_research
    WHERE entity_type=? AND entity_key=? AND claim_token=?`).get(subject.type, subject.key, token);
  if (!row) return false;
  const failed = status === "failed";
  const failures = failed ? (Number(row.failures) || 0) + 1 : 0;
  const nextAt = failed
    ? at + FAILURE_BACKOFF_MS[Math.min(FAILURE_BACKOFF_MS.length - 1, failures - 1)]
    : at + (REFRESH_MS[status] || REFRESH_MS.not_found);
  // Only a new sourced result replaces the page's research. A failed, unsure
  // or empty refresh keeps the last good result on the page.
  const replaces = status === "found" && !!findings;
  const keepsPrevious = !replaces && !!row.findings;
  database.prepare(`UPDATE catalog_research SET status=?,failures=?,researched_at=CASE WHEN ? THEN ? ELSE researched_at END,
      next_attempt_at=?,model=COALESCE(?,model),cost_micro_usd=cost_micro_usd+?,
      findings=CASE WHEN ? THEN ? ELSE findings END,last_reason=?,claim_token=NULL
    WHERE entity_type=? AND entity_key=? AND claim_token=?`)
    .run(keepsPrevious ? "found" : status, failures, replaces || !keepsPrevious ? 1 : 0, at, nextAt, model,
      Math.max(0, Math.round(costMicroUsd)), replaces ? 1 : 0, replaces ? JSON.stringify(findings) : null,
      reason ? String(reason).slice(0, 120) : null, subject.type, subject.key, token);
  return true;
}

// Researches up to `maxItems` pages. Returns what happened, for logs and tests.
export async function runCatalogResearchPass({
  database,
  env = process.env,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  signal,
  maxItems = 4,
  research = researchCatalogSubject,
} = {}) {
  const outcome = { researched: 0, published: 0, stopped: null };
  if (!catalogResearchConfigured(env)) return { ...outcome, stopped: "not_configured" };
  const control = readCatalogKnowledgeControl(database, { env, at: now() });
  if (control?.mode === "paused") return { ...outcome, stopped: "paused" };
  const cap = catalogResearchDailyBudgetMicroUsd(env);
  const model = catalogResearchModel(env);
  for (let index = 0; index < maxItems; index += 1) {
    if (signal?.aborted) return { ...outcome, stopped: "aborted" };
    const at = now();
    let budget = readBudget(database, at);
    if (budget.spentMicroUsd + RUN_RESERVE_MICRO_USD > cap) return { ...outcome, stopped: "daily_budget" };
    // Alternate artists and venues so neither backlog starves the other.
    const order = index % 2 === 0 ? ["artist", "venue"] : ["venue", "artist"];
    let subject = null;
    for (const type of order) {
      subject = type === "artist" ? nextArtistResearchSubject(database, { at }) : nextVenueResearchSubject(database, { at });
      if (subject) break;
    }
    if (!subject) return { ...outcome, stopped: "nothing_due" };
    const token = claimSubject(database, subject, at);
    if (!token) continue;
    let result;
    try {
      result = await research(subject, { apiKey: String(env.ANTHROPIC_API_KEY).trim(), model, fetchImpl, signal });
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "research_error";
      finishSubject(database, subject, token, { status: "failed", reason: code, at: now() });
      budget = readBudget(database, now());
      saveBudget(database, { ...budget, lastRunAt: now(), lastError: { code, at: now() } });
      // A bad key, a rate limit or an overloaded API will not clear up by
      // trying the next page straight away.
      if (["research_auth", "research_rate_limited", "research_overloaded", "research_unavailable"].includes(code) || signal?.aborted) {
        return { ...outcome, stopped: code };
      }
      continue;
    }
    outcome.researched += 1;
    const checked = validateCatalogResearchFindings(result.findings, {
      type: subject.type,
      name: subject.name,
      searchedUrls: result.searchedUrls,
    });
    const status = checked.ok ? "found" : checked.reason === "not_found" ? "not_found" : "unsure";
    finishSubject(database, subject, token, {
      status,
      findings: checked.ok ? checked.record : null,
      model: result.model,
      costMicroUsd: result.costMicroUsd,
      reason: checked.ok ? null : checked.reason,
      at: now(),
    });
    if (checked.ok) outcome.published += 1;
    budget = readBudget(database, now());
    saveBudget(database, {
      ...budget,
      spentMicroUsd: budget.spentMicroUsd + Math.max(0, Number(result.costMicroUsd) || 0),
      runs: budget.runs + 1,
      published: budget.published + (checked.ok ? 1 : 0),
      lastRunAt: now(),
    });
  }
  return outcome;
}

export function readCatalogResearch(database, { type, key, city = null }) {
  if (type === "artist") {
    const row = database.prepare(`SELECT findings,researched_at FROM catalog_research
      WHERE entity_type='artist' AND entity_key=? AND status='found'`).get(String(key || ""));
    return row ? publicCatalogResearch("artist", safeJson(row.findings), { researchedAt: row.researched_at }) : null;
  }
  const venue = canonicalVenueKey(key);
  if (!venue) return null;
  const rows = database.prepare(`SELECT entity_key,findings,researched_at FROM catalog_research
    WHERE entity_type='venue' AND status='found' AND entity_key>=? AND entity_key<? LIMIT 20`)
    .all(`${venue}|`, `${venue}|￿`);
  const wantedCity = text(city, 80).toLowerCase();
  // With a city, only that room's research. Without one, only when the name
  // is unambiguous.
  const row = wantedCity
    ? rows.find((entry) => entry.entity_key.split("|")[1] === wantedCity)
    : rows.length === 1 ? rows[0] : null;
  return row ? publicCatalogResearch("venue", safeJson(row.findings), { researchedAt: row.researched_at }) : null;
}

function safeJson(value) {
  try { return JSON.parse(value || "null"); }
  catch { return null; }
}

export function hideCatalogResearch(database, { type, key, at = Date.now() }) {
  const changed = database.prepare(`UPDATE catalog_research SET status='hidden',claim_token=NULL,next_attempt_at=?
    WHERE entity_type=? AND entity_key=?`).run(at, type, key).changes;
  return Number(changed || 0) > 0;
}

export function collectCatalogResearchStatus(database, { env = process.env, at = Date.now() } = {}) {
  const budget = readBudget(database, at);
  const counts = Object.fromEntries(database.prepare(`SELECT entity_type||':'||status k,COUNT(*) c FROM catalog_research GROUP BY k`)
    .all().map((row) => [row.k, row.c]));
  const count = (type, status) => Number(counts[`${type}:${status}`] || 0);
  const totals = (type) => ({
    found: count(type, "found"),
    notFound: count(type, "not_found"),
    unsure: count(type, "unsure"),
    failed: count(type, "failed"),
    hidden: count(type, "hidden"),
  });
  return {
    configured: catalogResearchConfigured(env),
    enabled: catalogResearchConfigured(env) && backgroundJobEnabled(env, "CATALOG_RESEARCH_ENABLED"),
    model: catalogResearchModel(env),
    dailyBudgetUsd: catalogResearchDailyBudgetMicroUsd(env) / 1_000_000,
    today: {
      spentUsd: Math.round(budget.spentMicroUsd / 10_000) / 100,
      runs: budget.runs,
      published: budget.published,
    },
    lastRunAt: budget.lastRunAt,
    lastError: budget.lastError,
    artists: totals("artist"),
    venues: totals("venue"),
  };
}

export function startCatalogResearchScheduler({ database, env = process.env, now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  ensureCatalogResearchSchema(database);
  if (!catalogResearchConfigured(env) || !backgroundJobEnabled(env, "CATALOG_RESEARCH_ENABLED")) return null;
  // A lease left by a stopped process expires by itself after LEASE_MS.
  return startPeriodicJob({
    initialDelayMs: 3 * MINUTE,
    intervalMs: 10 * MINUTE,
    run: async ({ signal }) => {
      const result = await runCatalogResearchPass({ database, env, now, fetchImpl, signal });
      if (result.researched || (result.stopped && !["nothing_due", "daily_budget", "paused"].includes(result.stopped))) {
        console.log(`[catalog-research] researched=${result.researched} published=${result.published} stopped=${result.stopped || "pass_done"}`);
      }
      return true;
    },
    report: (error) => console.error(`[catalog-research] pass failed safely: ${privateErrorLabel(error)}`),
  });
}
