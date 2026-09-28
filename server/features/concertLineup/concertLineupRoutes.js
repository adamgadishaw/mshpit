import { seenCountForNewShow, seenOrdinalForPost } from "../../supportingActs.js";

// The review form's "times seen" starting number: this show counted with
// every earlier one by date, times the artist opened, and earlier shows never
// logged. With postId, the number an existing review shows now.
export function concertLineupRoutes({ database, ApiError, requireUser, rateLimit, clean, cleanDate, artistLimit, catalogKeyExists }) {
  return {
    "GET /api/me/seen-count": (ctx) => {
      const user = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "seen-count", 120, 10 * 60 * 1000);
      const postId = clean(ctx.query?.postId, { max: 60 });
      if (postId) {
        const post = database.prepare("SELECT id,user_id FROM posts WHERE id=? AND removed=0").get(postId);
        if (!post || post.user_id !== user.id) throw new ApiError(404, "That review is unavailable.", "NOT_FOUND");
        return { count: seenOrdinalForPost(database, post.id) };
      }
      const artist = clean(ctx.query?.artist, { max: artistLimit });
      if (!artist) throw new ApiError(400, "Choose an artist first.", "VALIDATION_FAILED");
      const requestedKey = clean(ctx.query?.artistKey, { max: 120 });
      const artistKey = requestedKey && catalogKeyExists(requestedKey) ? requestedKey : null;
      return { count: seenCountForNewShow(database, { userId: user.id, artist, artistKey, date: cleanDate(ctx.query?.date) || "" }) };
    },
  };
}
