export function artistRecommendationRoutes({ service, requireUser, rateLimit }) {
  if (!service?.list || typeof requireUser !== "function" || typeof rateLimit !== "function") {
    throw new TypeError("Artist recommendation routes require complete dependencies");
  }
  return {
    "GET /api/me/artist-recommendations": (ctx) => {
      const viewer = requireUser(ctx);
      rateLimit(ctx, "artist-recommendations", 60, 10 * 60 * 1_000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return service.list(viewer, { limit: ctx.query?.limit });
    },
  };
}
