export function peopleSuggestionRoutes({ service, requireUser, rateLimit }) {
  return {
    "GET /api/people/suggestions": (ctx) => {
      const viewer = requireUser(ctx);
      rateLimit(ctx, "people-suggestions", 60, 10 * 60 * 1000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return { suggestions: service.list(viewer, { limit: ctx.query?.limit }) };
    },
  };
}
