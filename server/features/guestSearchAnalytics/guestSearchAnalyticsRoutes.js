import { recordGuestSearchAggregate } from "../../guestSearchAnalytics.js";

const TEN_MINUTES = 10 * 60 * 1000;

export function guestSearchAnalyticsRoutes({ database, ApiError, now, rateLimit }) {
  if (!database?.prepare || typeof ApiError !== "function" || typeof now !== "function" || typeof rateLimit !== "function") {
    throw new TypeError("Guest search analytics routes require complete boundary dependencies");
  }
  return Object.freeze({
    // The request address is used only by the expiring in-memory rate limiter.
    // Storage receives three categorical fields and a UTC day counter only.
    "POST /api/analytics/guest-search": (ctx) => {
      rateLimit(ctx, "guest-search-analytics", 120, TEN_MINUTES);
      const result = recordGuestSearchAggregate(ctx.body, { database, user: ctx.user, at: now() });
      if (result.reason === "invalid") {
        throw new ApiError(400, "That search metric is not valid.", "VALIDATION_FAILED");
      }
      return { ok: true, recorded: result.accepted === true };
    },
  });
}
