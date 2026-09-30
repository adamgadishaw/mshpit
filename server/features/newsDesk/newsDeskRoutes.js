import { createPngApiResponse } from "../../binaryApiResponse.js";
import { absolutePhotoCreditUrl, photoCreditPathFromArtwork } from "../../photoCredits.js";
import { ApiError } from "../../errors.js";
import { newsShareCardModel, SocialShareCardArtworkUnavailableError, SocialShareCardBusyError } from "../socialSharing/socialShareCardRenderer.js";

// Readers enforce bilateral blocks against each post's actual author.
export function newsDeskRoutes({ rateLimit, reader, renderer, resolveNewsArtwork = null, newsRegionFor = () => null }) {
  const previewModel = (story) => story ? newsShareCardModel(story, {
    ...(typeof resolveNewsArtwork === "function" ? resolveNewsArtwork(story) : {}),
    variant: "news-link",
  }) : null;
  const decodeCursor = (value) => {
    const [createdAt, id] = String(value || "").split(".");
    const at = Number(createdAt);
    return Number.isSafeInteger(at) && at > 0 && id && id.length <= 80 ? { createdAt: at, id } : null;
  };
  return {
    "GET /api/news-desk/stories": (ctx) => {
      rateLimit(ctx, "news-desk", 240, 10 * 60_000);
      const artist = typeof ctx.query?.artist === "string" ? ctx.query.artist.slice(0, 200) : null;
      const sort = ctx.query?.sort === "top" ? "top" : "latest";
      // A signed-in reader's answer depends on their blocks, so it is never
      // shared through a cache; guests all see the same public list.
      ctx.setHeader?.("Cache-Control", ctx.user ? "private, no-store" : "public, max-age=120");
      // A signed-in reader's news follows their region (newsRegions.js).
      const place = ctx.user ? newsRegionFor(ctx.user) : null;
      const result = reader.list({ limit: ctx.query?.limit, before: decodeCursor(ctx.query?.cursor), artist, sort, viewerId: ctx.user?.id || null,
        region: place?.region || null, city: place?.city || null });
      return {
        stories: result.stories,
        nextCursor: result.nextCursor ? `${result.nextCursor.createdAt}.${result.nextCursor.id}` : null,
      };
    },
    // The link-preview image (og:image) for a story's page. Public and cached;
    // the renderer also keeps recent cards in memory.
    "GET /api/news-desk/stories/:id/image.png": async (ctx) => {
      rateLimit(ctx, "news-desk-image", 120, 10 * 60_000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const id = String(ctx.params?.id || "");
      const viewerId = ctx.user?.id || null;
      const story = /^[A-Za-z0-9-]{1,80}$/u.test(id) ? reader.get(id, { viewerId }) : null;
      const model = previewModel(story);
      if (!model) throw new ApiError(404, "That story is not available.", "NOT_FOUND");
      try {
        const rendered = await renderer.render(model, { signal: ctx.signal || null });
        // Rendering awaits remote artwork. A block, removal, suspension or
        // edit during that wait must not leak the stale rendered card.
        const current = reader.get(id, { viewerId });
        const currentModel = previewModel(current);
        if (!currentModel || JSON.stringify(currentModel) !== JSON.stringify(model)) {
          throw new ApiError(404, "That story is not available.", "NOT_FOUND");
        }
        return createPngApiResponse(rendered.bytes, {
          canonicalUrl: model.canonicalUrl,
          filename: "mshpit-news.png",
          publicMaxAgeSeconds: viewerId || rendered.artworkFallback ? null : 120,
          photoCreditUrl: absolutePhotoCreditUrl(photoCreditPathFromArtwork(rendered.artwork)),
        });
      } catch (error) {
        if (error instanceof SocialShareCardBusyError || error instanceof SocialShareCardArtworkUnavailableError) {
          throw new ApiError(503, "The story image is busy. Try again in a moment.", "SHARE_RENDER_UNAVAILABLE", error);
        }
        throw error;
      }
    },
  };
}
