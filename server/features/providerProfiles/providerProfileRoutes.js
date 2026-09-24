import { readArtistProviderProfile, readVenueProviderProfile } from "./providerProfileService.js";

// Public reads of what the web profile agents stored. Reads never fetch.
export function providerProfileRoutes({ database, ApiError, rateLimit, decodedPathParam, resolveArtist, canonicalVenueKey }) {
  // Private: some artist pages are visible only to certain accounts.
  const cache = (ctx) => ctx.setHeader?.("Cache-Control", "private, max-age=300");
  return {
    "GET /api/artists/:key/links": (ctx) => {
      rateLimit(ctx, "provider-profile-read", 120, 60_000);
      const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
      const artist = resolveArtist(key, ctx);
      if (!artist) throw new ApiError(404, "This artist page is unavailable.", "NOT_FOUND");
      cache(ctx);
      return { profile: readArtistProviderProfile(database, artist.norm) };
    },
    "GET /api/venues/:key/details": (ctx) => {
      rateLimit(ctx, "provider-profile-read", 120, 60_000);
      const key = canonicalVenueKey(decodedPathParam(ctx, "key", { max: 200, label: "venue link" }));
      if (!key) throw new ApiError(400, "Choose a venue first.", "VALIDATION_FAILED");
      const providerVenueId = typeof ctx.query?.providerVenueId === "string" ? ctx.query.providerVenueId.slice(0, 100) : "";
      const city = typeof ctx.query?.city === "string" ? ctx.query.city.slice(0, 80) : "";
      cache(ctx);
      return { profile: readVenueProviderProfile(database, { venueKey: key, providerVenueId, city }) };
    },
  };
}
