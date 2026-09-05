import { createArtistArchiveRepository } from "./artistArchiveRepository.js";
import { createArtistArchiveService } from "./artistArchiveService.js";

const TEN_MINUTES = 10 * 60 * 1000;

export function artistArchiveRoutes({
  database,
  ApiError,
  assertArtistArchiveAvailable,
  clean,
  normName,
  projectMediaState,
  projectReviewUser,
  rateLimit,
  resolveArtistName,
}) {
  if (typeof ApiError !== "function" || typeof clean !== "function" || typeof normName !== "function"
    || typeof projectMediaState !== "function" || typeof projectReviewUser !== "function"
    || typeof rateLimit !== "function" || typeof resolveArtistName !== "function"
    || typeof assertArtistArchiveAvailable !== "function") {
    throw new TypeError("Artist archive routes require the API boundary dependencies");
  }
  const repository = createArtistArchiveRepository(database);
  const service = createArtistArchiveService({ repository, projectMediaState, projectReviewUser });

  function identity(ctx) {
    const artistKey = normName(clean(ctx.query?.artistKey, { max: 120 })) || null;
    const requestedName = clean(ctx.query?.name, { max: 120 }) || null;
    // SQLite NOCASE is ASCII-only, so a name-only archive request cannot be
    // trusted to resolve a protected Unicode identity. Current clients resolve
    // the durable catalogue key before opening an archive; reject stale or
    // hand-crafted name-only calls rather than guessing at a namesake.
    if (!artistKey) {
      throw new ApiError(400, "Refresh the artist page before opening its archive.", "VALIDATION_FAILED");
    }
    const canonicalName = artistKey ? clean(resolveArtistName(artistKey), { max: 120 }) || null : null;
    if (artistKey && canonicalName && requestedName && normName(requestedName) !== normName(canonicalName)) {
      throw new ApiError(400, "That artist identity changed. Refresh the artist page and try again.", "VALIDATION_FAILED");
    }
    const name = artistKey ? canonicalName : requestedName;
    if (!name) throw new ApiError(400, "Choose an artist before opening the archive.", "VALIDATION_FAILED");
    assertArtistArchiveAvailable({ artistKey, name });
    return { artistKey, name };
  }

  return {
    "GET /api/artists/archive": (ctx) => {
      rateLimit(ctx, "artist-archive", 30, TEN_MINUTES);
      return { archive: service.readArchive({ ...identity(ctx), viewer: ctx.user || null }) };
    },
    "GET /api/artists/archive/reviews": (ctx) => {
      rateLimit(ctx, "artist-archive-reviews", 120, TEN_MINUTES);
      const result = service.readReviews({
        ...identity(ctx),
        viewerId: ctx.user?.id || null,
        showKey: clean(ctx.query?.showKey, { max: 1_800 }) || null,
        tourKey: clean(ctx.query?.tourKey, { max: 1_800 }) || null,
        cursor: ctx.query?.cursor,
        limit: ctx.query?.limit,
      });
      if (!result) throw new ApiError(400, "That archive selection is invalid. Refresh and try again.", "VALIDATION_FAILED");
      return result;
    },
  };
}
