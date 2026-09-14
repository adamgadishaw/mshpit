export function pageHeadRoutes({ ApiError, rateLimit, pageHeadFor }) {
  return {
    "GET /api/page-head": (ctx) => {
      rateLimit(ctx, "public-page-head", 180, 10 * 60 * 1000);
      const path = ctx.query?.path;
      if (typeof path !== "string" || path.length > 500 || !/^\/(?!\/)/.test(path)
        || /[?#\\\u0000-\u0020\u007f]/.test(path)) {
        throw new ApiError(400, "Choose a valid public page.", "VALIDATION_FAILED");
      }
      // Deliberately pass the path only. A signed-in caller must get exactly
      // the same anonymous publication/privacy projection as a search crawler.
      const result = pageHeadFor(path);
      if (!result || typeof result.head !== "string" || result.head.length > 128_000) {
        throw new ApiError(503, "Page information is temporarily unavailable.", "PAGE_HEAD_UNAVAILABLE");
      }
      // Client navigation has a small short-lived in-memory cache. Do not let
      // intermediary caches retain a member's later-withdrawn public metadata.
      ctx.setHeader?.("Cache-Control", "no-store");
      return { path, head: result.head };
    },
  };
}
