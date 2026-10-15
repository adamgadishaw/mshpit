import { seenCountForNewShow, seenOrdinalForPost } from "../../supportingActs.js";
import { createLineupRepository } from "./lineupRepository.js";

const TEN_MINUTES = 10 * 60 * 1000;
const FORMATS = new Set(["headline", "co_headline", "festival"]);

// The review form's "times seen" starting number, the acts to suggest while
// someone writes a lineup, and an artist page's sets on other people's bills.
export function concertLineupRoutes({ database, ApiError, requireUser, rateLimit, clean, cleanDate, artistLimit, catalogKeyExists,
  normName = (value) => String(value || "").trim().toLowerCase(), artistNameForKey = () => null, projectAuthor = () => null }) {
  const lineups = createLineupRepository(database);
  return {
    // With postId, the number an existing review shows now; otherwise this
    // show counted with every earlier one by date, times the artist opened,
    // and earlier shows never logged.
    "GET /api/me/seen-count": (ctx) => {
      const user = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "seen-count", 120, TEN_MINUTES);
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

    "GET /api/lineup/suggestions": (ctx) => {
      requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "lineup-suggestions", 120, TEN_MINUTES);
      const artist = clean(ctx.query?.artist, { max: artistLimit });
      if (!artist) throw new ApiError(400, "Choose an artist or festival first.", "VALIDATION_FAILED");
      const requestedKey = clean(ctx.query?.artistKey, { max: 120 });
      const format = clean(ctx.query?.showFormat, { max: 20 }) || "headline";
      if (!FORMATS.has(format)) throw new ApiError(400, "Choose a concert, a co-headline show or a festival.", "VALIDATION_FAILED");
      return {
        suggestions: lineups.suggestions({
          artist,
          artistKey: requestedKey && catalogKeyExists(requestedKey) ? requestedKey : null,
          date: cleanDate(ctx.query?.date) || "",
          venue: clean(ctx.query?.venue, { max: 120 }) || "",
          showFormat: format,
        }),
      };
    },

    "GET /api/artists/sets": (ctx) => {
      rateLimit(ctx, "artist-sets", 120, TEN_MINUTES);
      const requestedKey = normName(clean(ctx.query?.artistKey, { max: 120 })) || null;
      const artistKey = requestedKey && catalogKeyExists(requestedKey) ? requestedKey : null;
      const name = (artistKey ? artistNameForKey(artistKey) : null) || clean(ctx.query?.name, { max: 120 }) || "";
      if (!artistKey && !name) throw new ApiError(400, "Choose an artist before loading sets.", "VALIDATION_FAILED");
      const result = lineups.artistSets({ artistKey, name, viewerId: ctx.user?.id || null });
      const authors = new Map();
      const author = (id) => {
        if (!authors.has(id)) authors.set(id, projectAuthor(id));
        return authors.get(id);
      };
      return {
        ...result,
        sets: result.sets.map(({ userId, ...set }) => ({ ...set, user: author(userId) })).filter((set) => set.user),
      };
    },
  };
}
