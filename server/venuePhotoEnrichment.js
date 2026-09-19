import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import { startPeriodicJob } from "./periodicJobScheduler.js";
import { artistKnowledgeStorageReady, artistKnowledgeMemoryReady } from "./artistKnowledgeRefresh.js";
import { readCatalogKnowledgeControl } from "./catalogKnowledgeControl.js";
import { lookupVenuePhoto } from "./venuePhotoProvider.js";
import { registerRuntimeVenuePhotoReader, venuePhotoCatalogControlsIdentity } from "./venuePhotoCatalog.js";
import { providerVenuePhotoCatalogKey } from "./venuePhotoCatalogIdentity.js";
import { createRuntimeVenuePhotoReader, runtimeVenuePhotoIdentity as fingerprint } from "./runtimeVenuePhotoReader.js";
import { isMirroredVenuePhoto } from "../scripts/lib/venue-photo-mirror-batch.mjs";
import { mirrorLicensedVenuePhoto, venuePhotoMirrorConfigured } from "../scripts/lib/venue-photo-mirror.mjs";

const MINUTE = 60_000, DAY = 86_400_000, MiB = 1024 ** 2;
export const VENUE_PHOTO_LIMITS = Object.freeze({ attemptsPerDay: 100, dailyBytes: 20 * MiB,
  totalBytes: 256 * MiB, imageBytes: MiB, batch: 3, ledgerRows: 20_000, intervalMinutes: 15 });
const day = at => new Date(at).toISOString().slice(0, 10);

export function venuePhotoEnrichmentEnabled(env = process.env) {
  const explicit = Object.hasOwn(env, "VENUE_PHOTO_ENRICHMENT_ENABLED");
  return backgroundJobEnabled(explicit ? env : { ...env, VENUE_PHOTO_ENRICHMENT_ENABLED: env.ARTIST_KNOWLEDGE_ENABLED }, "VENUE_PHOTO_ENRICHMENT_ENABLED");
}

export function ensureVenuePhotoEnrichmentSchema(database, { at = Date.now() } = {}) {
  database.exec(`CREATE TABLE IF NOT EXISTS venue_photo_enrichment (
    venue_key TEXT PRIMARY KEY CHECK(length(venue_key)<=260), identity TEXT NOT NULL CHECK(length(identity)<=800),
    status TEXT NOT NULL CHECK(status IN ('leased','filled','no_match','failed','protected','revoked')),
    attempted_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, claim_token TEXT,
    photo_json TEXT CHECK(photo_json IS NULL OR length(photo_json)<=16000));
    CREATE INDEX IF NOT EXISTS idx_venue_photo_due ON venue_photo_enrichment(next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_tourdates_venue_photo_identity
      ON tour_dates(lower(trim(venue_provider_id)))
      WHERE source='ticketmaster' AND owner_id IS NULL;
    CREATE TABLE IF NOT EXISTS venue_photo_budget (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    utc_day TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
    daily_bytes INTEGER NOT NULL DEFAULT 0 CHECK(daily_bytes>=0), total_bytes INTEGER NOT NULL DEFAULT 0 CHECK(total_bytes>=0),
    next_pass_at INTEGER NOT NULL DEFAULT 0, last_status TEXT NOT NULL DEFAULT 'ready', updated_at INTEGER NOT NULL);`);
  database.prepare("INSERT OR IGNORE INTO venue_photo_budget(singleton,utc_day,updated_at) VALUES(1,?,?)").run(day(at), at);
}

function budget(database, at) {
  const row = database.prepare("SELECT * FROM venue_photo_budget WHERE singleton=1").get();
  if (!row) return null;
  return day(at) > row.utc_day ? { ...row, utc_day: day(at), attempts: 0, daily_bytes: 0 } : row;
}

export function readVenuePhotoEnrichmentStatus(database, { env = process.env, at = Date.now() } = {}) {
  const enabled = venuePhotoEnrichmentEnabled(env), configured = venuePhotoMirrorConfigured(env);
  const base = { enabled, configured, installed: false, limits: VENUE_PHOTO_LIMITS };
  try {
    const installed = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='venue_photo_budget'").get();
    if (!installed) return { ...base, state: "not_started" };
    const row = budget(database, at), counts = {};
    if (!row) return { ...base, state: "unavailable" };
    for (const count of database.prepare("SELECT status,COUNT(*) AS count FROM venue_photo_enrichment GROUP BY status").all()) counts[count.status] = count.count;
    const paused = readCatalogKnowledgeControl(database, { env, at })?.mode === "paused";
    return { ...base, installed: true, state: !enabled ? "disabled" : !configured ? "storage_unconfigured" : paused ? "paused" : row.last_status,
      counts, attemptsToday: row.attempts, reservedTodayBytes: row.daily_bytes,
      reservedTotalBytes: row.total_bytes, nextPassAt: row.next_pass_at, updatedAt: row.updated_at };
  } catch {
    // Optional diagnostics fail closed; GET does not create or repair schema.
    return { ...base, state: "unavailable" };
  }
}

// Revocation is a durable tombstone. Neither automatic catch-up nor pause/resume
// can republish it; stored byte reservations remain charged conservatively.
export function revokeRuntimeVenuePhoto(database, key, { at = Date.now() } = {}) {
  return database.prepare("UPDATE venue_photo_enrichment SET status='revoked',photo_json=NULL,claim_token=NULL,attempted_at=? WHERE venue_key=?")
    .run(at, key).changes > 0;
}

export function createVenuePhotoRefresher({ database, lookup = lookupVenuePhoto, mirror = mirrorLicensedVenuePhoto,
  now = Date.now, storageReady = () => true, memoryReady = () => true, env = process.env,
  configured = () => venuePhotoMirrorConfigured(env), wait = delay, controlsIdentity = venuePhotoCatalogControlsIdentity } = {}) {
  ensureVenuePhotoEnrichmentSchema(database, { at: now() });
  const read = database.prepare("SELECT * FROM venue_photo_enrichment WHERE venue_key=?");
  const candidates = database.prepare(`SELECT MIN(t.venue) AS name,t.source,t.venue_provider_id AS providerVenueId,
    MIN(t.venue_city) AS city,MIN(t.venue_country_code) AS country,MAX(t.place) AS place,
    MAX(t.lat) AS lat,MAX(t.lng) AS lng,MIN(t.date) AS next_date
    FROM tour_dates t WHERE t.source='ticketmaster' AND t.owner_id IS NULL AND t.date>=?
      AND length(trim(t.venue_provider_id)) BETWEEN 1 AND 180 AND length(trim(t.venue)) BETWEEN 1 AND 180
      AND length(trim(t.venue_city)) BETWEEN 1 AND 120 AND length(trim(t.venue_country_code))=2
      AND NOT EXISTS (SELECT 1 FROM venue_photo_enrichment v
        WHERE v.venue_key='provider:ticketmaster:'||lower(trim(t.venue_provider_id))
          AND (v.status IN ('filled','protected','revoked') OR v.next_attempt_at>?))
    GROUP BY lower(trim(t.venue_provider_id))
    HAVING COUNT(DISTINCT lower(trim(t.venue)))=1 AND COUNT(DISTINCT lower(trim(t.venue_city)))=1
      AND COUNT(DISTINCT upper(trim(t.venue_country_code)))=1
      AND COUNT(DISTINCT t.lat)<=1 AND COUNT(DISTINCT t.lng)<=1
      AND SUM(CASE WHEN (t.lat IS NULL)<>(t.lng IS NULL) THEN 1 ELSE 0 END)=0
    ORDER BY next_date,lower(trim(t.venue_provider_id)) LIMIT 12`);
  const currentIdentity = database.prepare(`SELECT MIN(venue) AS name,MIN(venue_city) AS city,MIN(venue_country_code) AS country
    FROM tour_dates WHERE source='ticketmaster' AND owner_id IS NULL AND lower(trim(venue_provider_id))=?
    HAVING COUNT(DISTINCT lower(trim(venue)))=1 AND COUNT(DISTINCT lower(trim(venue_city)))=1
      AND COUNT(DISTINCT upper(trim(venue_country_code)))=1`);
  const claim = database.prepare(`INSERT INTO venue_photo_enrichment(venue_key,identity,status,attempted_at,next_attempt_at,claim_token)
    VALUES(?,?,'leased',?,?,?) ON CONFLICT(venue_key) DO UPDATE SET identity=excluded.identity,status='leased',
      attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,claim_token=excluded.claim_token
    WHERE venue_photo_enrichment.status NOT IN ('filled','protected','revoked') AND venue_photo_enrichment.next_attempt_at<=excluded.attempted_at`);
  const finish = database.prepare("UPDATE venue_photo_enrichment SET status=?,photo_json=?,next_attempt_at=?,claim_token=NULL WHERE venue_key=? AND claim_token=?");
  const mark = state => database.prepare("UPDATE venue_photo_budget SET last_status=?,updated_at=? WHERE singleton=1").run(state, now());
  function reserveBudget(images = false) {
    database.exec("SAVEPOINT venue_photo_reserve");
    try {
      database.prepare("UPDATE venue_photo_budget SET utc_day=?,attempts=0,daily_bytes=0 WHERE singleton=1 AND utc_day<?").run(day(now()), day(now()));
      const result = images
        ? database.prepare("UPDATE venue_photo_budget SET daily_bytes=daily_bytes+?,total_bytes=total_bytes+?,updated_at=? WHERE singleton=1 AND daily_bytes+?<=? AND total_bytes+?<=?")
          .run(MiB, MiB, now(), MiB, VENUE_PHOTO_LIMITS.dailyBytes, MiB, VENUE_PHOTO_LIMITS.totalBytes)
        : database.prepare("UPDATE venue_photo_budget SET attempts=attempts+1,updated_at=? WHERE singleton=1 AND attempts<?").run(now(), VENUE_PHOTO_LIMITS.attemptsPerDay);
      const state = result.changes ? budget(database, now()) : null;
      database.exec("RELEASE venue_photo_reserve");
      return state;
    } catch (error) {
      database.exec("ROLLBACK TO venue_photo_reserve"); database.exec("RELEASE venue_photo_reserve"); throw error;
    }
  }
  const identityCurrent = (venue, token) => read.get(venue.key)?.claim_token === token
    && fingerprint(currentIdentity.get(venue.providerVenueId.toLowerCase())) === fingerprint(venue)
    && !controlsIdentity(venue.name, venue);
  let active = null;

  const readPhoto = createRuntimeVenuePhotoReader(database, { env });

  async function pass({ signal } = {}) {
    if (!venuePhotoEnrichmentEnabled(env)) { mark("disabled"); return false; }
    if (!configured()) { mark("storage_unconfigured"); return false; }
    if (readCatalogKnowledgeControl(database, { env, at: now() })?.mode === "paused") { mark("paused"); return false; }
    if (!storageReady() || !memoryReady()) { mark("resources_deferred"); return false; }
    const initial = budget(database, now());
    if (initial.next_pass_at > now()) return false;
    if (!database.prepare("UPDATE venue_photo_budget SET next_pass_at=?,last_status='working' WHERE singleton=1 AND next_pass_at<=?")
      .run(now() + 15 * MINUTE, now()).changes) return false;
    const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
    let checked = 0, filled = 0;
    for (const candidate of candidates.all(day(now()), now())) {
      if (checked >= VENUE_PHOTO_LIMITS.batch || boundedSignal.aborted) break;
      if (!storageReady() || !memoryReady()) { mark("resources_deferred"); break; }
      if (readCatalogKnowledgeControl(database, { env, at: now() })?.mode === "paused") { mark("paused"); break; }
      const venue = { ...candidate, key: providerVenuePhotoCatalogKey(candidate.source, candidate.providerVenueId) };
      if (!venue.key) continue;
      const prior = read.get(venue.key);
      if (!prior && database.prepare("SELECT COUNT(*) AS count FROM venue_photo_enrichment").get().count >= VENUE_PHOTO_LIMITS.ledgerRows) { mark("ledger_limit"); break; }
      const state = budget(database, now());
      if (state.attempts >= VENUE_PHOTO_LIMITS.attemptsPerDay) { mark("daily_attempt_limit"); break; }
      const token = randomUUID();
      if (!claim.run(venue.key, fingerprint(venue), now(), now() + 10 * MINUTE, token).changes) continue;
      if (controlsIdentity(venue.name, venue)) { finish.run("protected", null, now() + 30 * DAY, venue.key, token); continue; }
      if (!reserveBudget()) { finish.run("failed", null, now() + DAY, venue.key, token); mark("daily_attempt_limit"); break; }
      checked += 1;
      try {
        await wait(1100, undefined, { signal: boundedSignal });
        const source = await lookup(venue, { signal: boundedSignal });
        const preflight = () => boundedSignal.aborted ? "interrupted"
          : !storageReady() || !memoryReady() ? "resources_deferred"
            : readCatalogKnowledgeControl(database, { env, at: now() })?.mode === "paused" ? "paused" : null;
        const deferred = preflight();
        if (deferred) { finish.run("leased", null, now() + 15 * MINUTE, venue.key, token); mark(deferred); break; }
        if (!identityCurrent(venue, token)) { finish.run("failed", null, now() + DAY, venue.key, token); continue; }
        if (!source) { finish.run("no_match", null, now() + 30 * DAY, venue.key, token); continue; }
        const reservation = reserveBudget(true);
        if (!reservation) {
          finish.run("failed", null, now() + DAY, venue.key, token); mark("image_budget_limit"); break;
        }
        // Reserve before PUT. Crashes, aborts and failed writes never refund an
        // object whose remote existence we cannot safely disprove.
        const photo = await mirror({ venueKey: venue.key, photo: source, env, outputMaxBytes: MiB,
          fetchImpl: (input, options = {}) => fetch(input, { ...options,
            signal: options.signal ? AbortSignal.any([boundedSignal, options.signal]) : boundedSignal }) });
        const serialized = JSON.stringify(photo);
        if (!isMirroredVenuePhoto(photo, env) || photo.mirror.byteSize > MiB || serialized.length > 16000) throw new Error("Invalid mirrored venue photo");
        const publishDeferred = preflight();
        if (publishDeferred) { finish.run("leased", null, now() + 15 * MINUTE, venue.key, token); mark(publishDeferred); break; }
        if (!identityCurrent(venue, token)) { finish.run("failed", null, now() + DAY, venue.key, token); continue; }
        if (finish.run("filled", serialized, now() + 3650 * DAY, venue.key, token).changes) {
          const unused = MiB - photo.mirror.byteSize;
          database.prepare("UPDATE venue_photo_budget SET daily_bytes=MAX(0,daily_bytes-CASE WHEN utc_day=? THEN ? ELSE 0 END),total_bytes=total_bytes-?,updated_at=? WHERE singleton=1 AND total_bytes>=?")
            .run(reservation.utc_day, unused, unused, now(), unused);
          filled += 1;
        }
      } catch (error) {
        finish.run(boundedSignal.aborted ? "leased" : "failed", null, now() + (boundedSignal.aborted ? 15 * MINUTE : DAY), venue.key, token);
        mark(boundedSignal.aborted ? "interrupted" : "provider_or_storage_failed");
        if (Number.isFinite(error?.retryAt) && error.retryAt > now()) {
          database.prepare("UPDATE venue_photo_budget SET next_pass_at=MAX(next_pass_at,?) WHERE singleton=1")
            .run(Math.min(now() + DAY, error.retryAt));
        }
        // Provider trouble cools the whole pass, not just this venue.
        break;
      }
    }
    if (budget(database, now()).last_status === "working") mark(filled > 0 ? "filled" : checked > 0 ? "checked_no_photo" : "waiting");
    return { checked, filled };
  }
  return { readPhoto, status: () => readVenuePhotoEnrichmentStatus(database, { env, at: now() }),
    run(options = {}) { if (!active) active = pass(options).finally(() => { active = null; }); return active; } };
}

export function startVenuePhotoScheduler({ database, directory, databasePath, env = process.env,
  log = summary => console.info("[pit] venue photo maintenance", summary) } = {}) {
  const worker = createVenuePhotoRefresher({ database, env,
    storageReady: () => artistKnowledgeStorageReady(directory, databasePath), memoryReady: artistKnowledgeMemoryReady });
  const unregister = registerRuntimeVenuePhotoReader(worker.readPhoto);
  let previousState;
  const reportSummary = (result, startup = false) => {
    const status = worker.status();
    if (!startup && status.state === previousState && !result?.checked) return;
    previousState = status.state;
    try {
      log({ state: status.state, enabled: status.enabled, configured: status.configured,
        checked: result?.checked || 0, filled: result?.filled || 0,
        attemptsToday: status.attemptsToday ?? null,
        reservedTotalBytes: status.reservedTotalBytes ?? null });
    } catch {
      // architecture: allow-empty-catch -- diagnostics cannot fail background work.
    }
  };
  reportSummary(null, true);
  const scheduler = startPeriodicJob({ initialDelayMs: 3 * MINUTE, intervalMs: 15 * MINUTE,
    run: ({ signal }) => runBackgroundJob(async () => {
      const result = await worker.run({ signal });
      reportSummary(result);
      return result;
    }),
    report: () => console.warn("[pit] venue photo maintenance failed safely") });
  return { trigger: scheduler.trigger, async stop(options) { await scheduler.stop(options); unregister(); } };
}
