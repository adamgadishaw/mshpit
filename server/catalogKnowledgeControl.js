// Durable, bounded control: no catalogue dumps and no member history.
import { backgroundJobEnabled } from "./backgroundJobs.js";
export const CATALOG_KNOWLEDGE_KEY = "artist-knowledge:v2:control";
export const CATALOG_MODES = Object.freeze(["paused", "catch_up", "maintenance"]);
const MINUTE = 60_000;
const validInt = (value) => Number.isSafeInteger(value) && value >= 0;
const day = (at) => new Date(at).toISOString().slice(0, 10);
const clamp = (value, fallback, max) => Number.isFinite(Number(value))
  ? Math.max(1, Math.min(max, Math.floor(Number(value)))) : fallback;
const meta = (database) => database.prepare("SELECT value FROM app_meta WHERE key=?").get(CATALOG_KNOWLEDGE_KEY)?.value;
const save = (database, state) => database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(CATALOG_KNOWLEDGE_KEY, JSON.stringify(state));

export function catalogKnowledgeLimits(mode, env = {}) {
  const catchUp = mode === "catch_up";
  return Object.freeze({ lanes: catchUp ? clamp(env.ARTIST_KNOWLEDGE_CATCHUP_LANES, 10, 10) : 1,
    maxArtistsPerPass: catchUp ? clamp(env.ARTIST_KNOWLEDGE_CATCHUP_BATCH, 40, 40) : clamp(env.ARTIST_KNOWLEDGE_BATCH, 10, 10),
    intervalMinutes: catchUp ? 2 : 15, maxPassSeconds: 45,
    // A missing source may cost only one request; do not stop useful catch-up
    // at 3,000 such checks while most of the provider allowance is unused.
    // This does NOT increase network rate, the 12,000-request cap or disk growth.
    maxAttemptsPerDay: clamp(env.ARTIST_KNOWLEDGE_DAILY_ARTISTS, catchUp ? 10000 : 960, catchUp ? 10000 : 3000),
    maxRequestsPerDay: clamp(env.ARTIST_KNOWLEDGE_DAILY_REQUESTS, 12000, 12000),
    providerSpacingMs: 1100, maxResponseKiB: 512, maxBiographyCharacters: 1200,
    maxGrowthMiB: 256 });
}

function parse(text) {
  if (typeof text !== "string" || text.length > 4096) return null;
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || raw.version !== 1 || !CATALOG_MODES.includes(raw.mode)
    || !/^\d{4}-\d{2}-\d{2}$/.test(raw.utcDay || "")
    || ["attempts", "requests", "nextPassAt", "updatedAt"].some((key) => !validInt(raw[key]))
    || (raw.initialSweepFinishedAt !== null && !validInt(raw.initialSweepFinishedAt))
    || (raw.baselineBytes !== null && !validInt(raw.baselineBytes))) return null;
  return { version: 1, mode: raw.mode, utcDay: raw.utcDay, attempts: raw.attempts,
    requests: raw.requests, nextPassAt: raw.nextPassAt, updatedAt: raw.updatedAt,
    initialSweepFinishedAt: raw.initialSweepFinishedAt, baselineBytes: raw.baselineBytes };
}

export function ensureCatalogKnowledgeControl(database, { env = process.env, at = Date.now() } = {}) {
  if (meta(database) != null) return;
  const mode = CATALOG_MODES.includes(env.ARTIST_KNOWLEDGE_MODE) ? env.ARTIST_KNOWLEDGE_MODE : "maintenance";
  save(database, { version: 1, mode, utcDay: day(at), attempts: 0, requests: 0,
    nextPassAt: 0, updatedAt: at, initialSweepFinishedAt: null, baselineBytes: null });
}

export function readCatalogKnowledgeControl(database, { env = process.env, at = Date.now() } = {}) {
  const state = parse(meta(database));
  if (!state) return null;
  // Never reset backwards after a wall-clock correction.
  const currentDay = day(at);
  const budget = currentDay > state.utcDay ? { utcDay: currentDay, attempts: 0, requests: 0 }
    : { utcDay: state.utcDay, attempts: state.attempts, requests: state.requests };
  return { mode: state.mode, effectiveMode: backgroundJobEnabled(env, "ARTIST_KNOWLEDGE_ENABLED") ? state.mode : "disabled",
    nextPassAt: state.nextPassAt, updatedAt: state.updatedAt,
    initialSweepFinishedAt: state.initialSweepFinishedAt, baselineBytes: state.baselineBytes,
    limits: catalogKnowledgeLimits(state.mode, env), budget,
    budgetResetAt: Date.parse(`${budget.utcDay}T00:00:00.000Z`) + 24 * 60 * MINUTE };
}

export function setCatalogKnowledgeMode(database, mode, { env = process.env, at = Date.now() } = {}) {
  if (!CATALOG_MODES.includes(mode)) throw new TypeError("Unsupported catalog maintenance mode");
  ensureCatalogKnowledgeControl(database, { env, at });
  const state = parse(meta(database));
  if (!state) throw new Error("Catalog maintenance control needs repair");
  // Preserve counters, cooldown, claims, due times and growth baseline.
  save(database, { ...state, mode, updatedAt: at });
  return readCatalogKnowledgeControl(database, { env, at });
}

export function reserveCatalogKnowledgeBudget(database, kind, { env = process.env, at = Date.now() } = {}) {
  if (!["attempts", "requests"].includes(kind)) throw new TypeError("Unsupported catalog budget");
  const state = parse(meta(database));
  if (!state || state.mode === "paused" || !backgroundJobEnabled(env, "ARTIST_KNOWLEDGE_ENABLED")) return false;
  const control = readCatalogKnowledgeControl(database, { env, at });
  const cap = kind === "attempts" ? control.limits.maxAttemptsPerDay : control.limits.maxRequestsPerDay;
  if (control.budget[kind] >= cap) return false;
  save(database, { ...state, ...control.budget, [kind]: control.budget[kind] + 1 });
  return true;
}

export function reserveCatalogKnowledgePass(database, { env = process.env, at = Date.now() } = {}) {
  const state = parse(meta(database));
  const control = readCatalogKnowledgeControl(database, { env, at });
  if (!state || !control || state.mode === "paused" || control.effectiveMode === "disabled" || state.nextPassAt > at) return false;
  save(database, { ...state, ...control.budget,
    nextPassAt: at + control.limits.intervalMinutes * MINUTE });
  return true;
}

export function catalogKnowledgeGrowthReady(database, bytes) {
  const state = parse(meta(database));
  if (!state || !validInt(bytes)) return false;
  if (state.baselineBytes === null) {
    save(database, { ...state, baselineBytes: bytes });
    return true;
  }
  return bytes - state.baselineBytes <= 256 * 1024 ** 2;
}

const exactIdentitySql = "length(a.mbid)=36 AND substr(a.mbid,9,1)='-' AND substr(a.mbid,14,1)='-' AND substr(a.mbid,19,1)='-' AND substr(a.mbid,24,1)='-' AND length(replace(a.mbid,'-',''))=32 AND lower(replace(a.mbid,'-','')) NOT GLOB '*[^0-9a-f]*'";
const missingSql = "((trim(COALESCE(a.bio,''))='' AND p.artist_key IS NULL) OR trim(COALESCE(a.country,''))='')";
const progressCache = new WeakMap();
export function collectCatalogKnowledgeProgress(database, { at = Date.now(), fresh = false } = {}) {
  const cached = progressCache.get(database);
  if (!fresh && cached && at >= cached.at && at - cached.at < MINUTE) return cached.value;
  const row = database.prepare(`SELECT COUNT(*) AS totalArtists,
    COALESCE(SUM(CASE WHEN c.artist_key IS NOT NULL THEN 1 ELSE 0 END),0) AS totalTracked,
    COALESCE(SUM(CASE WHEN c.status='filled' THEN 1 ELSE 0 END),0) AS filled,
    COALESCE(SUM(CASE WHEN trim(COALESCE(a.bio,''))<>'' THEN 1 ELSE 0 END),0) AS biographyPresent,
    COALESCE(SUM(CASE WHEN trim(COALESCE(a.bio,''))='' AND p.artist_key IS NULL THEN 1 ELSE 0 END),0) AS biographyMissing,
    COALESCE(SUM(CASE WHEN trim(COALESCE(a.bio,''))='' AND p.artist_key IS NOT NULL THEN 1 ELSE 0 END),0) AS biographyProtected,
    COALESCE(SUM(CASE WHEN trim(COALESCE(a.country,''))<>'' THEN 1 ELSE 0 END),0) AS countryPresent,
    COALESCE(SUM(CASE WHEN trim(COALESCE(a.country,''))='' THEN 1 ELSE 0 END),0) AS countryMissing,
    COALESCE(SUM(CASE WHEN ${missingSql} AND (${exactIdentitySql}) THEN 1 ELSE 0 END),0) AS eligible,
    COALESCE(SUM(CASE WHEN ${missingSql} AND NOT COALESCE((${exactIdentitySql}),0) THEN 1 ELSE 0 END),0) AS needsIdentity,
    COALESCE(SUM(CASE WHEN NOT ${missingSql} THEN 1 ELSE 0 END),0) AS alreadyComplete,
    COALESCE(SUM(CASE WHEN ${missingSql} AND (${exactIdentitySql}) AND
      (c.artist_key IS NULL OR c.mbid<>lower(a.mbid) OR c.status='leased') THEN 1 ELSE 0 END),0) AS unprocessed,
    COALESCE(SUM(CASE WHEN ${missingSql} AND (${exactIdentitySql}) AND c.mbid=lower(a.mbid)
      AND c.status IN ('filled','no_match','skipped') THEN 1 ELSE 0 END),0) AS unresolved,
    COALESCE(SUM(CASE WHEN c.status='failed' THEN 1 ELSE 0 END),0) AS retrying
    FROM artists a LEFT JOIN artist_profiles p ON p.artist_key=a.norm
    LEFT JOIN artist_knowledge_checks c ON c.artist_key=a.norm`).get();
  const { biographyPresent, biographyMissing, biographyProtected, countryPresent, countryMissing, ...counts } = row;
  const value = Object.freeze({ ...counts, attempted: Math.max(0, row.eligible - row.unprocessed),
    fieldCoverage: Object.freeze({ biographyPresent, biographyMissing, biographyProtected, countryPresent, countryMissing }) });
  progressCache.set(database, { at, value });
  return value;
}

export function completeCatalogKnowledgeSweep(database, { at = Date.now() } = {}) {
  const state = parse(meta(database));
  if (!state || state.mode !== "catch_up") return false;
  if (collectCatalogKnowledgeProgress(database, { at, fresh: true }).unprocessed > 0) return false;
  save(database, { ...state, mode: "maintenance", updatedAt: at,
    initialSweepFinishedAt: state.initialSweepFinishedAt ?? at });
  return true;
}

export function collectCatalogKnowledgeControl(database, options = {}) {
  const control = readCatalogKnowledgeControl(database, options);
  return control ? { ...control, progress: collectCatalogKnowledgeProgress(database, options) } : null;
}
