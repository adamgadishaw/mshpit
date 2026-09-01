import { createArtistDeathWatchRepository } from "./artistDeathWatchRepository.js";
import { createArtistDeathWatchService } from "./artistDeathWatchService.js";

const HOUR_MS = 60 * 60 * 1000;
const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "no-store");

function safeProviderCode(error) {
  const raw = typeof error?.code === "string" ? error.code.trim().toLowerCase() : "provider_error";
  return /^[a-z][a-z0-9_]{1,60}$/u.test(raw) ? raw : "provider_error";
}

const defaultScanErrorReporter = (error) => {
  console.error(`[memorial-watch] manual background scan failed safely: code=${safeProviderCode(error)}`);
};

export function artistDeathWatchRoutes({
  database,
  ApiError,
  decodeArtistKey,
  now,
  rateLimit,
  recordModerationAction,
  requireAdmin,
  requireModerator,
  reportScanError = defaultScanErrorReporter,
  service: suppliedService = null,
}) {
  if (typeof ApiError !== "function" || typeof decodeArtistKey !== "function" || typeof now !== "function"
    || typeof rateLimit !== "function" || typeof recordModerationAction !== "function"
    || typeof requireAdmin !== "function" || typeof requireModerator !== "function"
    || typeof reportScanError !== "function") {
    throw new TypeError("Artist death-watch routes require complete boundary dependencies");
  }
  const service = suppliedService || createArtistDeathWatchService({
    repository: createArtistDeathWatchRepository(database),
  });
  let manualScan = null;
  let manualScanStartedAt = null;

  const backgroundState = (snapshot = {}) => Object.freeze({
    running: snapshot?.running === true || manualScan != null,
    startedAt: manualScanStartedAt ?? snapshot?.startedAt ?? null,
  });

  const snapshotWithBackgroundState = () => {
    const snapshot = service.readSnapshot();
    return { ...snapshot, ...backgroundState(snapshot) };
  };

  const startManualScan = (scanAt) => {
    if (manualScan) return false;
    manualScanStartedAt = scanAt;
    const pending = Promise.resolve().then(() => service.scan({ at: scanAt, force: true }));
    manualScan = pending;
    void pending.then(
      () => {
        if (manualScan === pending) {
          manualScan = null;
          manualScanStartedAt = null;
        }
      },
      (error) => {
        try { reportScanError(error); }
        catch { /* A logger failure must never become an unhandled rejection. */ }
        if (manualScan === pending) {
          manualScan = null;
          manualScanStartedAt = null;
        }
      },
    );
    return true;
  };

  const artistKey = (ctx) => {
    const decoded = decodeArtistKey(ctx);
    const key = typeof decoded === "string" ? decoded.trim().toLowerCase() : "";
    if (!key || key.length > 200 || /[\u0000-\u001F\u007F]/u.test(key)) {
      throw new ApiError(400, "Choose a valid artist alert.", "VALIDATION_FAILED");
    }
    return key;
  };

  return Object.freeze({
    "GET /api/moderation/artist-death-watch": (ctx) => {
      requireModerator(ctx);
      noStore(ctx);
      const status = typeof ctx.query?.status === "string" ? ctx.query.status.trim().toLowerCase() : "pending";
      const candidates = service.list({ status, limit: ctx.query?.limit });
      if (!candidates) throw new ApiError(400, "Choose a valid artist-alert filter.", "VALIDATION_FAILED");
      return { ...snapshotWithBackgroundState(), candidates };
    },

    "PATCH /api/moderation/artist-death-watch/:key": (ctx) => {
      const actor = requireModerator(ctx);
      noStore(ctx);
      const status = typeof ctx.body?.status === "string" ? ctx.body.status.trim().toLowerCase() : "";
      const result = service.review({
        artistKey: artistKey(ctx),
        status,
        reviewerId: actor.id,
        at: now(),
        audit: ({ previous, next }) => recordModerationAction(
          ctx,
          "artist_death_candidate_review",
          "artist_death_candidate",
          artistKey(ctx),
          "",
          previous,
          next,
        ),
      });
      if (!result) throw new ApiError(404, "That artist alert is no longer available.", "NOT_FOUND");
      return result;
    },

    "PATCH /api/admin/artist-death-watch/settings": (ctx) => {
      requireAdmin(ctx);
      noStore(ctx);
      if (typeof ctx.body?.enabled !== "boolean") {
        throw new ApiError(400, "Choose whether artist death alerts are on or off.", "VALIDATION_FAILED");
      }
      const result = service.setEnabled(ctx.body.enabled, {
        at: now(),
        audit: ({ previous, next }) => recordModerationAction(
          ctx,
          "artist_death_watch_settings",
          "artist_death_watch",
          "singleton",
          "",
          previous,
          next,
        ),
      });
      return result;
    },

    "POST /api/admin/artist-death-watch/scan": (ctx) => {
      requireAdmin(ctx);
      noStore(ctx);
      rateLimit(ctx, "artist-death-watch-manual", 4, HOUR_MS);
      const scanAt = now();
      const started = startManualScan(scanAt);
      return {
        accepted: true,
        started,
        ...snapshotWithBackgroundState(),
      };
    },
  });
}
