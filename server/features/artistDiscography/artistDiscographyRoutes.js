const TEN_MINUTES = 10 * 60 * 1000;

function providerBoundary(error, { ApiError, ProviderError }) {
  if (error instanceof ProviderError) {
    throw new ApiError(502, "The discography source missed its cue. Try again shortly.", "PROVIDER_UNAVAILABLE", error);
  }
  throw error;
}

export function artistDiscographyRoutes({
  ApiError,
  ProviderError,
  clean,
  loadDiscography,
  rateLimit,
  requireUser,
}) {
  if (typeof ApiError !== "function" || typeof ProviderError !== "function" || typeof clean !== "function"
    || typeof loadDiscography !== "function" || typeof rateLimit !== "function" || typeof requireUser !== "function") {
    throw new TypeError("Artist discography routes require complete boundary dependencies");
  }
  const artistName = (ctx) => {
    const name = clean(ctx.body?.name ?? ctx.query?.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.", "VALIDATION_FAILED");
    return name;
  };

  return Object.freeze({
    // Public reads may warm only the server-selected canonical identity.
    "GET /api/artists/discography": async (ctx) => {
      const name = artistName(ctx);
      rateLimit(ctx, "discography", 40, TEN_MINUTES);
      try {
        return await loadDiscography(name, { signal: ctx.signal });
      } catch (error) {
        return providerBoundary(error, { ApiError, ProviderError });
      }
    },

    // A fan's same-name disambiguation is an ephemeral view, never authority to
    // overwrite the shared catalogue. POST also brings origin/JSON protections.
    "POST /api/artists/discography/selection": async (ctx) => {
      requireUser(ctx);
      const name = artistName(ctx);
      const rawId = String(ctx.body?.deezerId || "");
      if (!/^\d{1,15}$/u.test(rawId)) {
        throw new ApiError(400, "Choose a valid artist match.", "VALIDATION_FAILED");
      }
      rateLimit(ctx, "discography-selection", 20, TEN_MINUTES);
      try {
        return await loadDiscography(name, {
          deezerId: Number(rawId),
          ephemeralSelection: true,
          signal: ctx.signal,
        });
      } catch (error) {
        return providerBoundary(error, { ApiError, ProviderError });
      }
    },
  });
}
