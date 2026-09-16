import { readCatalogKnowledgeControl } from "./catalogKnowledgeControl.js";

const STATUS_KEY = "artist_photo_seed_status_v1";
const BACKOFF_KEY = "spotify_artist_photo_backoff_v1";
const runtime = new WeakMap();
const enabledValues = new Set(["1", "true", "yes", "on", "enabled"]);
const phases = new Set(["waiting", "queued", "running", "paused", "stopped"]);
const pauseReasons = new Set(["catalog_paused", "catalog_job_running", "resource_pressure", "rate_limited", "quota_exceeded", "authentication_failed", "access_revoked", "provider_unavailable", "job_failed", "shutdown"]);
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(40, Math.floor(Number(value)))) : 0;
const timestamp = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;

function safeLastPass(value) {
  if (!value || typeof value !== "object" || !timestamp(value.finishedAt)) return null;
  return {
    at: timestamp(value.finishedAt), startedAt: timestamp(value.startedAt), finishedAt: timestamp(value.finishedAt),
    attempted: count(value.attempted), filled: count(value.filled), noMatch: count(value.noMatch),
    failed: count(value.failed), skipped: count(value.skipped), priorityAttempted: count(value.priorityAttempted),
    pauseReason: pauseReasons.has(value.pauseReason) ? value.pauseReason : null,
  };
}

function readRecord(database, key) {
  if (!database?.prepare) return null;
  const row = database.prepare("SELECT value FROM app_meta WHERE key=?").get(key);
  try { return JSON.parse(row?.value || "null"); } catch { return null; }
}

// A single sanitized row survives restarts; no artist identity, provider URL,
// request text or credential is retained. This reader never changes state.
export function readArtistPhotoSeedStatus({ env = process.env, at = Date.now(), database } = {}) {
  const enabled = enabledValues.has(String(env.ARTIST_PHOTO_SEED_ENABLED || "").trim().toLowerCase());
  // Presence only; importing the provider client would initialize db.js via
  // musicProviders. A moderation status read must have no such side effects.
  const configured = Boolean(String(env?.SPOTIFY_CLIENT_ID || "").trim() && String(env?.SPOTIFY_CLIENT_SECRET || "").trim());
  const base = { enabled, configured,
    batchSize: Number.isFinite(Number(env.ARTIST_PHOTO_SEED_BATCH)) ? Math.max(1, count(env.ARTIST_PHOTO_SEED_BATCH)) : 20,
    intervalMinutes: 15 };
  const unavailable = { ...base, available: false, running: false, phase: "unavailable", pauseReason: "status_unavailable", nextPassAt: null, retryAt: null, lastPass: null };
  if (!database?.prepare) return unavailable;
  try {
    const lastPass = safeLastPass(readRecord(database, STATUS_KEY));
    const live = runtime.get(database);
    const backoff = readRecord(database, BACKOFF_KEY);
    const retryAt = timestamp(backoff?.until) > at ? timestamp(backoff.until) : null;
    const catalogPaused = readCatalogKnowledgeControl(database, { env, at })?.mode === "paused";
    const pauseReason = !enabled ? "disabled" : !configured ? "credentials_unavailable"
      : catalogPaused ? "catalog_paused"
      : retryAt ? (backoff?.code === "quota_exceeded" ? "quota_exceeded" : "rate_limited")
        : live?.pauseReason || (lastPass?.failed ? lastPass.pauseReason : null);
    return {
      ...base, available: true, running: enabled && configured && live?.phase === "running",
      phase: !enabled ? "disabled" : !configured ? "unconfigured" : catalogPaused || retryAt ? "paused" : live?.phase || (pauseReason ? "paused" : "waiting"),
      pauseReason, nextPassAt: timestamp(live?.nextPassAt), retryAt, lastPass,
    };
  } catch {
    // Status is ancillary to moderation: a closed/old database must not break
    // the entire response or create missing schema as a side effect of GET.
    return unavailable;
  };
}

export function createArtistPhotoSeedReporter({ database, clock = Date.now } = {}) {
  const owner = {};
  runtime.set(database, { owner, phase: "waiting", pauseReason: null, nextPassAt: null });
  return {
    update({ phase = "waiting", pauseReason = null, nextPassAt = null } = {}) {
      if (runtime.get(database)?.owner !== owner) return;
      runtime.set(database, { owner, phase: phases.has(phase) ? phase : "waiting", pauseReason: pauseReasons.has(pauseReason) ? pauseReason : null, nextPassAt: timestamp(nextPassAt) });
    },
    finish(stats = {}, { startedAt, pauseReason = null } = {}) {
      if (runtime.get(database)?.owner !== owner) return;
      const record = safeLastPass({ ...stats, startedAt, finishedAt: clock(), pauseReason });
      database.prepare(`INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(STATUS_KEY, JSON.stringify(record));
    },
  };
}
