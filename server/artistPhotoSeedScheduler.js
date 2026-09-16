import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import {
  catalogSeedStatus,
  fillMissingArtistPhotos,
  migrateLegacySpotifyArtistPhotoData,
  purgeExpiredSpotifyArtistPhotoData,
  purgeSpotifyArtistPhotoData,
} from "./catalogSeed.js";
import { privateErrorLabel } from "./errors.js";
import { spotifyArtistPhotoConfigured } from "./spotifyArtistPhotos.js";
import { createArtistPhotoSeedReporter } from "./artistPhotoSeedStatus.js";
import { db } from "./db.js";
import { readCatalogKnowledgeControl } from "./catalogKnowledgeControl.js";

const DEFAULT_BATCH = 20;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 2 * 60 * 1000;
const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

const boundedBatch = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(40, Math.floor(parsed))) : DEFAULT_BATCH;
};

const safeLogToken = (value, fallback) => {
  const token = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/u.test(token) ? token : fallback;
};

export function isArtistPhotoSeedEnabled(env = process.env) {
  return ENABLED_VALUES.has(String(env?.ARTIST_PHOTO_SEED_ENABLED || "").trim().toLowerCase())
    && spotifyArtistPhotoConfigured(env);
}

function isArtistPhotoPurgeRequested(env = process.env) {
  return ENABLED_VALUES.has(String(env?.ARTIST_PHOTO_PURGE_REQUESTED || "").trim().toLowerCase());
}

let scheduler = null;

export function startArtistPhotoSeedScheduler({
  env = process.env,
  intervalMs = DEFAULT_INTERVAL_MS,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  runBatch = fillMissingArtistPhotos,
  catalogStatus = catalogSeedStatus,
  migrateLegacy = migrateLegacySpotifyArtistPhotoData,
  purgeExpired = purgeExpiredSpotifyArtistPhotoData,
  purgeAll = purgeSpotifyArtistPhotoData,
  report: providedReporter = null,
  clock = Date.now,
  readControl = () => readCatalogKnowledgeControl(db, { env, at: clock() }),
  logger = console,
} = {}) {
  const seedRequested = ENABLED_VALUES.has(
    String(env?.ARTIST_PHOTO_SEED_ENABLED || "").trim().toLowerCase(),
  );
  if (isArtistPhotoPurgeRequested(env)) {
    let purged = 0;
    try {
      purged = purgeAll();
    } catch (error) {
      logger.error?.(`[pit] artist photo data purge failed safely cause=${privateErrorLabel(error)}`);
    }
    if (purged) logger.log?.(`[pit] removed ${purged} stored Spotify artist photo records.`);
  }
  if (!seedRequested) {
    logger.log?.("[pit] Spotify artist photo seeding disabled; stored photos were retained unless an explicit purge was requested.");
    return null;
  }
  if (!spotifyArtistPhotoConfigured(env)) {
    logger.warn?.("[pit] Spotify artist photo seeding paused because credentials are unavailable; stored photos were retained.");
    return null;
  }
  if (scheduler) return scheduler;
  const reporter = providedReporter || createArtistPhotoSeedReporter({ database: db, clock });
  const report = Object.fromEntries(["update", "finish"].map((method) => [method, (...args) => {
    try { reporter[method]?.(...args); }
    catch (error) { logger.error?.(`[pit] artist photo progress could not be recorded cause=${privateErrorLabel(error)}`); }
  }]));
  try {
    migrateLegacy();
  } catch (error) {
    logger.error?.(`[pit] artist photo data maintenance failed safely cause=${privateErrorLabel(error)}`);
  }
  const limit = boundedBatch(env.ARTIST_PHOTO_SEED_BATCH);
  const controller = new AbortController();
  const state = { first: null, timer: null, running: null, stopped: false, trigger: null, stop: null };
  const scheduledAt = clock();
  const cadenceMs = Math.max(60_000, intervalMs);
  const nextPassAt = () => scheduledAt + (Math.floor(Math.max(0, clock() - scheduledAt) / cadenceMs) + 1) * cadenceMs;
  const failureReason = (code) => ({
    CATALOG_PHOTOS_RATE_LIMITED: "rate_limited", CATALOG_PHOTOS_QUOTA_EXCEEDED: "quota_exceeded",
    CATALOG_PHOTOS_AUTHENTICATION_FAILED: "authentication_failed", CATALOG_PHOTOS_AUTH_REVOKED: "access_revoked",
    CATALOG_PHOTOS_PROVIDER_UNAVAILABLE: "provider_unavailable",
  }[code] || "provider_unavailable");
  const trigger = () => {
    if (state.stopped || state.running) return state.running;
    if (readControl()?.mode === "paused") {
      report.update({ phase: "paused", pauseReason: "catalog_paused", nextPassAt: nextPassAt() });
      return Promise.resolve({ skipped: "catalog_paused" });
    }
    if (catalogStatus()?.running) {
      report.update({ phase: "paused", pauseReason: "catalog_job_running", nextPassAt: nextPassAt() });
      return Promise.resolve({ skipped: "catalog_job_running" });
    }
    let startedAt = null;
    report.update({ phase: "queued", nextPassAt: nextPassAt() });
    state.running = runBackgroundJob(async () => {
      startedAt = clock();
      // The shared coordinator can queue this pass behind another job. Recheck
      // the current control before beginning any migration or provider work.
      if (controller.signal.aborted || readControl()?.mode === "paused") {
        return { attempted: 0, filled: 0, failed: 0, stopped: true, modePaused: readControl()?.mode === "paused" };
      }
      report.update({ phase: "running", nextPassAt: nextPassAt() });
      migrateLegacy();
      const stats = await runBatch({
        limit,
        signal: controller.signal,
        shouldStop: () => controller.signal.aborted || readControl()?.mode === "paused",
      });
      if (stats?.providerFailure?.code === "CATALOG_PHOTOS_AUTH_REVOKED") purgeAll();
      else if (!stats?.providerFailure && Number(stats?.failed) === 0 && Number(stats?.attempted) > 0 && readControl()?.mode !== "paused") {
        purgeExpired();
      }
      return { ...stats, modePaused: readControl()?.mode === "paused" };
    })
      .then((stats) => {
        const pauseReason = state.stopped ? "shutdown" : stats?.modePaused ? "catalog_paused" : stats?.providerFailure ? failureReason(stats.providerFailure.code) : null;
        report.finish(stats, { startedAt, pauseReason });
        report.update({ phase: state.stopped ? "stopped" : pauseReason ? "paused" : "waiting", pauseReason, nextPassAt: state.stopped ? null : nextPassAt() });
        if (Number(stats?.failed) > 0) {
          const provider = safeLogToken(stats?.providerFailure?.provider, "provider");
          const code = safeLogToken(stats?.providerFailure?.code, "unavailable");
          logger.warn?.(`[pit] artist photo provider unavailable provider=${provider} code=${code}`);
        } else if (stats?.attempted) {
          logger.log?.(`[pit] artist photos: ${stats.filled} saved, ${stats.noMatch} unmatched, ${stats.failed} provider failures.`);
        }
        return stats;
      })
      .catch((error) => {
        const pauseReason = state.stopped ? "shutdown" : error?.code === "MEMORY_PRESSURE" ? "resource_pressure" : "job_failed";
        report.finish({ failed: pauseReason === "job_failed" ? 1 : 0 }, { startedAt, pauseReason });
        report.update({ phase: state.stopped ? "stopped" : "paused", pauseReason, nextPassAt: state.stopped ? null : nextPassAt() });
        if (!state.stopped && error?.name !== "AbortError") {
          logger.error?.(`[pit] artist photo seeding failed safely cause=${privateErrorLabel(error)}`);
        }
        return null;
      })
      .finally(() => { state.running = null; });
    return state.running;
  };
  state.trigger = trigger;
  report.update({ phase: "waiting", nextPassAt: clock() + Math.max(0, initialDelayMs) });
  state.first = setTimeout(trigger, Math.max(0, initialDelayMs));
  state.first.unref?.();
  state.timer = setInterval(trigger, Math.max(60_000, intervalMs));
  state.timer.unref?.();
  state.stop = ({ abortActive = true } = {}) => {
    if (state.stopped) return state.running || Promise.resolve();
    state.stopped = true;
    report.update({ phase: "stopped", pauseReason: "shutdown" });
    clearTimeout(state.first);
    clearInterval(state.timer);
    if (abortActive) controller.abort(new DOMException("Server stopping", "AbortError"));
    return state.running || Promise.resolve();
  };
  scheduler = state;
  return scheduler;
}

export function stopArtistPhotoSeedScheduler(options) {
  if (!scheduler) return Promise.resolve();
  const active = scheduler;
  scheduler = null;
  return active.stop(options);
}
