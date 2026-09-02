import {
  cleanFeedImpressionBatch,
  recordFeedImpressions,
} from "../../feedImpressions.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const REQUESTS_PER_WINDOW = 120;
const EVENTS_PER_WINDOW = 1_000;

export function feedImpressionRoutes({
  ApiError,
  database,
  invalidateRecommendationSnapshotForViewer,
  now,
  rateLimit,
  requireUser,
  reserveVolume,
}) {
  if (typeof ApiError !== "function" || !database
    || typeof invalidateRecommendationSnapshotForViewer !== "function"
    || typeof now !== "function" || typeof rateLimit !== "function"
    || typeof requireUser !== "function" || typeof reserveVolume !== "function") {
    throw new TypeError("Feed impression routes require complete boundary dependencies");
  }

  return Object.freeze({
    "POST /api/feed/impressions": (ctx) => {
      const user = requireUser(ctx);
      rateLimit(ctx, "feed-impressions", REQUESTS_PER_WINDOW, TEN_MINUTES_MS);
      const batch = cleanFeedImpressionBatch(ctx.body?.impressions);
      // Bound rows, not only HTTP calls: legal maximum-size batches cannot turn
      // one account into thousands of synchronous writes per window.
      for (let index = 0; index < batch.impressions.length; index++) {
        if (!reserveVolume(`feed-impression-volume:user:${user.id}`, EVENTS_PER_WINDOW, TEN_MINUTES_MS)) {
          throw new ApiError(429, "Your feed history is catching up. Try again shortly.", "RATE_LIMITED");
        }
      }
      const result = recordFeedImpressions(database, {
        userId: user.id,
        impressions: batch.impressions,
        at: now(),
      });
      if (result.recorded) invalidateRecommendationSnapshotForViewer(user.id);
      return {
        received: batch.received,
        recorded: result.recorded,
        counted: result.counted,
        // Every syntactically valid event is acknowledged on a 2xx, including a
        // removed/blocked/self-view no-op, so an offline retry queue cannot loop.
        acknowledgedEventIds: batch.impressions.map((entry) => entry.eventId),
      };
    },
  });
}
