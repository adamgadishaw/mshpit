import { attachViewerLikes } from "../../postViewerLikes.js";
import { createArtistReviewRepository } from "./artistReviewRepository.js";
import { createArtistReviewService } from "./artistReviewService.js";

const TEN_MINUTES = 10 * 60 * 1000;

export function artistReviewRoutes({
  database,
  ApiError,
  clean,
  normName,
  projectPost,
  projectPosts = null,
  rateLimit,
  resolveArtistName,
}) {
  if (typeof ApiError !== "function" || typeof clean !== "function" || typeof normName !== "function"
    || typeof rateLimit !== "function" || typeof resolveArtistName !== "function") {
    throw new TypeError("Artist review routes require the API boundary dependencies");
  }
  const repository = createArtistReviewRepository(database);
  const service = createArtistReviewService({
    repository,
    projectPost,
    projectPosts,
    attachViewerLikes: (rows, viewerId) => attachViewerLikes(database, rows, viewerId),
  });

  return {
    "GET /api/artists/reviews": (ctx) => {
      rateLimit(ctx, "artist-reviews", 120, TEN_MINUTES);
      const artistKey = normName(clean(ctx.query?.artistKey, { max: 120 })) || null;
      const requestedName = clean(ctx.query?.name, { max: 120 }) || null;
      const canonicalName = artistKey ? clean(resolveArtistName(artistKey), { max: 120 }) || null : null;
      if (artistKey && canonicalName && requestedName && normName(requestedName) !== normName(canonicalName)) {
        throw new ApiError(400, "That artist identity changed. Refresh the artist page and try again.", "VALIDATION_FAILED");
      }
      // A bound key is authoritative. Only the server-resolved catalog name may
      // pull in pre-binding legacy reviews; an arbitrary client-supplied name
      // must never merge a second artist's history into this page.
      const name = artistKey ? canonicalName : requestedName;
      if (!artistKey && !name) {
        throw new ApiError(400, "Choose an artist before loading reviews.", "VALIDATION_FAILED");
      }
      const reviews = service.readTopReviews({
        artistKey,
        name,
        viewerId: ctx.user?.id || null,
        limit: ctx.query?.limit,
      });
      return { reviews };
    },
  };
}
