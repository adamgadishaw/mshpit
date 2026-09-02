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
  try {
    migrateLegacy();
  } catch (error) {
    logger.error?.(`[pit] artist photo data maintenance failed safely cause=${privateErrorLabel(error)}`);
  }
  const limit = boundedBatch(env.ARTIST_PHOTO_SEED_BATCH);
  const controller = new AbortController();
  const state = { first: null, timer: null, running: null, stopped: false, trigger: null, stop: null };
  const trigger = () => {
    if (state.stopped || state.running) return state.running;
    if (catalogStatus()?.running) return Promise.resolve({ skipped: "catalog_job_running" });
    state.running = runBackgroundJob(async () => {
      migrateLegacy();
      const stats = await runBatch({
        limit,
        signal: controller.signal,
        shouldStop: () => controller.signal.aborted,
      });
      if (stats?.providerFailure?.code === "CATALOG_PHOTOS_AUTH_REVOKED") purgeAll();
      else if (!stats?.providerFailure && Number(stats?.failed) === 0 && Number(stats?.attempted) > 0) {
        purgeExpired();
      }
      return stats;
    })
      .then((stats) => {
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
        if (!state.stopped && error?.name !== "AbortError") {
          logger.error?.(`[pit] artist photo seeding failed safely cause=${privateErrorLabel(error)}`);
        }
        return null;
      })
      .finally(() => { state.running = null; });
    return state.running;
  };
  state.trigger = trigger;
  state.first = setTimeout(trigger, Math.max(0, initialDelayMs));
  state.first.unref?.();
  state.timer = setInterval(trigger, Math.max(60_000, intervalMs));
  state.timer.unref?.();
  state.stop = ({ abortActive = true } = {}) => {
    if (state.stopped) return state.running || Promise.resolve();
    state.stopped = true;
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
