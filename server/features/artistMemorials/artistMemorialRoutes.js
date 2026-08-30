import { createArtistMemorialRepository } from "./artistMemorialRepository.js";
import { createArtistMemorialService } from "./artistMemorialService.js";

const TEN_MINUTES = 10 * 60 * 1000;
const ARTIST_KEY_MAX = 180;
const MUSICBRAINZ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "no-store");

export function artistMemorialRoutes({
  database,
  ApiError,
  assertSafeAuthoredText,
  decodeArtistKey,
  normName,
  now,
  rateLimit,
  recordModerationAction,
  requireAdmin,
  resolveArtist,
  deathWatchService = null,
  logger = console,
}) {
  if (typeof ApiError !== "function" || typeof assertSafeAuthoredText !== "function"
    || typeof decodeArtistKey !== "function"
    || typeof normName !== "function" || typeof now !== "function" || typeof rateLimit !== "function"
    || typeof recordModerationAction !== "function" || typeof requireAdmin !== "function"
    || typeof resolveArtist !== "function") {
    throw new TypeError("Artist memorial routes require complete boundary dependencies");
  }
  const repository = createArtistMemorialRepository(database);
  const service = createArtistMemorialService({ repository });

  function artistKey(ctx) {
    const decoded = decodeArtistKey(ctx);
    const raw = typeof decoded === "string" ? decoded.trim() : "";
    if (!raw || raw.length > ARTIST_KEY_MAX || /[\u0000-\u001F\u007F]/u.test(raw)) {
      throw new ApiError(400, "Choose a valid artist before opening the memorial.", "VALIDATION_FAILED");
    }
    const key = normName(raw);
    if (!key) throw new ApiError(400, "Choose a valid artist before opening the memorial.", "VALIDATION_FAILED");
    return key;
  }

  function canonicalArtist(key) {
    const row = resolveArtist(key);
    if (!row) throw new ApiError(404, "That artist is no longer in the catalog.", "NOT_FOUND");
    const resolvedKey = normName(String(row.norm || row.key || ""));
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const mbid = typeof row.mbid === "string" ? row.mbid.trim() : "";
    if (!resolvedKey || resolvedKey !== key || !name || !MUSICBRAINZ_ID.test(mbid)) {
      throw new ApiError(
        409,
        "Enrich this artist to an exact MusicBrainz catalog identity before creating a memorial.",
        "CONFLICT",
      );
    }
    return { key: resolvedKey, name, mbid: mbid.toLowerCase() };
  }

  return Object.freeze({
    "GET /api/admin/artist-memorials": (ctx) => {
      requireAdmin(ctx);
      noStore(ctx);
      const memorials = service.listAdmin({
        status: ctx.query?.status,
        query: ctx.query?.q,
        limit: ctx.query?.limit,
        at: now(),
      });
      if (!memorials) {
        throw new ApiError(400, "Choose valid memorial filters and try again.", "VALIDATION_FAILED");
      }
      return { memorials };
    },

    "PUT /api/admin/artist-memorials/:key": (ctx) => {
      const actor = requireAdmin(ctx);
      noStore(ctx);
      const artist = canonicalArtist(artistKey(ctx));
      const body = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
      if (body.expectedArtistMbid != null && body.expectedArtistMbid !== ""
        && typeof body.expectedArtistMbid !== "string") {
        throw new ApiError(400, "Choose a valid MusicBrainz-backed artist and try again.", "VALIDATION_FAILED");
      }
      const expectedArtistMbid = typeof body.expectedArtistMbid === "string" && body.expectedArtistMbid !== ""
        ? body.expectedArtistMbid.trim().toLowerCase()
        : null;
      if (expectedArtistMbid != null && !MUSICBRAINZ_ID.test(expectedArtistMbid)) {
        throw new ApiError(400, "Choose a valid MusicBrainz-backed artist and try again.", "VALIDATION_FAILED");
      }
      if (expectedArtistMbid != null && expectedArtistMbid !== artist.mbid) {
        throw new ApiError(
          409,
          "This catalog artist changed since you selected it. Search again before saving the memorial.",
          "CONFLICT",
        );
      }
      const { expectedArtistMbid: _expectedArtistMbid, ...memorialInput } = body;
      assertSafeAuthoredText(ctx.body?.summary, { field: "memorial summary" });
      if (ctx.body?.thankYou) assertSafeAuthoredText(ctx.body.thankYou, { field: "memorial thank-you" });
      if (ctx.body?.sourceTitle) assertSafeAuthoredText(ctx.body.sourceTitle, { field: "memorial source title" });
      for (const accomplishment of Array.isArray(ctx.body?.accomplishments) ? ctx.body.accomplishments : []) {
        assertSafeAuthoredText(accomplishment, { field: "artist accomplishment" });
      }
      const result = service.upsert(memorialInput, {
        artistKey: artist.key,
        artistName: artist.name,
        artistMbid: artist.mbid,
        at: now(),
        // The durable audit intentionally contains only categorical state,
        // dates, and an accomplishment count. It excludes memorial prose,
        // evidence URLs/titles, request metadata, and account analytics.
        audit: ({ previous, next }) => recordModerationAction(
          ctx,
          "artist_memorial_upsert",
          "artist_memorial",
          artist.key,
          "",
          previous,
          next,
        ),
      });
      if (!result.ok) {
        if (result.conflict) {
          throw new ApiError(409, result.message || "Review the artist identity and try again.", "CONFLICT");
        }
        throw new ApiError(400, result.message || "Check the memorial details and try again.", "VALIDATION_FAILED");
      }
      if (result.memorial?.status === "published") {
        try {
          deathWatchService?.markMemorialized?.({
            artistKey: artist.key,
            artistMbid: artist.mbid,
            reviewerId: actor.id,
            at: now(),
          });
        } catch (error) {
          // Publishing the permanent memorial is authoritative. The private
          // queue also excludes/reconciles this exact published identity, so a
          // transient follow-up failure must not roll back a public tribute.
          logger?.error?.("Artist death alert reconciliation deferred", {
            artistKey: artist.key,
            errorCode: typeof error?.code === "string" ? error.code : "reconciliation_failed",
          });
        }
      }
      return { changed: result.changed, memorial: result.memorial };
    },

    "GET /api/artists/:key/memorial": (ctx) => {
      rateLimit(ctx, "artist-memorial-public", 120, TEN_MINUTES);
      const key = artistKey(ctx);
      const row = resolveArtist(key);
      const currentKey = row ? normName(String(row.norm || row.key || "")) : "";
      const currentMbid = typeof row?.mbid === "string" ? row.mbid.trim().toLowerCase() : "";
      return {
        memorial: service.readPublic({
          artistKey: key,
          artistMbid: currentKey === key && MUSICBRAINZ_ID.test(currentMbid) ? currentMbid : null,
          at: now(),
        }),
      };
    },
  });
}
