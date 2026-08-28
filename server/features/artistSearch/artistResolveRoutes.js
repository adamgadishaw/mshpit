const TEN_MINUTES = 10 * 60 * 1000;

export function artistResolveRoutes({
  ApiError,
  clean,
  clearMissingArtist,
  findArtist,
  normName,
  persistExactMusicBrainzIdentity,
  projectArtist,
  rateLimit,
  requireVerifiedUser,
}) {
  if (typeof ApiError !== "function" || typeof clean !== "function"
    || typeof clearMissingArtist !== "function" || typeof findArtist !== "function"
    || typeof normName !== "function" || typeof persistExactMusicBrainzIdentity !== "function"
    || typeof projectArtist !== "function" || typeof rateLimit !== "function"
    || typeof requireVerifiedUser !== "function") {
    throw new TypeError("Artist resolve routes require complete boundary dependencies");
  }

  return Object.freeze({
    // Choosing a transient directory result is an explicit authenticated
    // mutation. Re-resolve the exact provider identity, verify the MBID shown
    // to the member, and only then create the shared catalog row used by post
    // binding. The public GET lookup remains read-only and safe for type-ahead.
    "POST /api/artists/resolve": async (ctx) => {
      requireVerifiedUser(ctx);
      rateLimit(ctx, "artist-resolve-persist", 20, TEN_MINUTES);
      const name = clean(ctx.body?.name, { max: 120 });
      const expectedMbid = clean(ctx.body?.mbid, { max: 80 });
      if (!name) {
        throw new ApiError(400, "Choose one artist before attaching it.", "VALIDATION_FAILED");
      }
      const key = normName(name);
      const existing = findArtist(key);
      if (existing) {
        if (expectedMbid && String(existing.mbid || "").toLowerCase() !== expectedMbid.toLowerCase()) {
          throw new ApiError(409, "That artist identity changed. Search again before attaching it.", "CONFLICT");
        }
        return { artist: projectArtist(existing), created: false };
      }
      const persisted = await persistExactMusicBrainzIdentity(name, {
        signal: ctx.signal,
        expectedMbid,
      });
      clearMissingArtist(key);
      return { artist: projectArtist(persisted), created: true };
    },
  });
}
