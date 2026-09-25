import { decodeNewsCursor, encodeNewsCursor } from "./artistNewsReader.js";

// News is public: anyone can read the latest releases and new tour dates.
// "Following" needs an account and shows only the artists you follow.
export function artistUpdatesRoutes({ ApiError, rateLimit, requireUser, readNews, resolveArtistKey }) {
  const page = (ctx, options) => {
    const result = readNews({ ...options, cursor: decodeNewsCursor(ctx.query?.cursor), limit: Number(ctx.query?.limit) || 20 });
    return { items: result.items, nextCursor: encodeNewsCursor(result.nextCursor) };
  };
  return {
    "GET /api/news": (ctx) => {
      rateLimit(ctx, "news", 240, 10 * 60_000);
      if (ctx.query?.scope === "following") {
        const user = requireUser(ctx);
        ctx.setHeader?.("Cache-Control", "private, no-store");
        return page(ctx, { followerId: user.id });
      }
      ctx.setHeader?.("Cache-Control", "public, max-age=120");
      return page(ctx, {});
    },
    "GET /api/artists/:key/news": (ctx) => {
      rateLimit(ctx, "artist-news", 240, 10 * 60_000);
      const artistKey = resolveArtistKey(ctx);
      if (!artistKey) throw new ApiError(404, "This artist page is unavailable.", "NOT_FOUND");
      ctx.setHeader?.("Cache-Control", "public, max-age=120");
      return page(ctx, { artistKey });
    },
  };
}
