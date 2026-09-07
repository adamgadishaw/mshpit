export function artistLiveSummaryRoutes({ service, rateLimit, decodedPathParam, resolveArtist }) {
  return {
    "GET /api/artists/:key/live-summary": (ctx) => {
      // Counts and unreleased dates can depend on the viewer; never CDN-cache.
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "artist-live-summary", 90, 60_000);
      const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
      return service.read({ artist: resolveArtist(key), viewer: ctx.user || null, query: ctx.query || {} });
    },
  };
}
