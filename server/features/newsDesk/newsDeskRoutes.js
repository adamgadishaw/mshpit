import { createPngApiResponse } from "../../binaryApiResponse.js";
import { ApiError } from "../../errors.js";
import { newsShareCardModel, SocialShareCardArtworkUnavailableError, SocialShareCardBusyError } from "../socialSharing/socialShareCardRenderer.js";

// The news desk's stories are public, like any public post.
export function newsDeskRoutes({ rateLimit, reader, renderer }) {
  const decodeCursor = (value) => {
    const [createdAt, id] = String(value || "").split(".");
    const at = Number(createdAt);
    return Number.isSafeInteger(at) && at > 0 && id && id.length <= 80 ? { createdAt: at, id } : null;
  };
  return {
    "GET /api/news-desk/stories": (ctx) => {
      rateLimit(ctx, "news-desk", 240, 10 * 60_000);
      const artist = typeof ctx.query?.artist === "string" ? ctx.query.artist.slice(0, 200) : null;
      const result = reader.list({ limit: Number(ctx.query?.limit) || 20, before: decodeCursor(ctx.query?.cursor), artist });
      ctx.setHeader?.("Cache-Control", "public, max-age=120");
      return {
        stories: result.stories,
        nextCursor: result.nextCursor ? `${result.nextCursor.createdAt}.${result.nextCursor.id}` : null,
      };
    },
    // The link-preview image (og:image) for a story's page. Public and cached;
    // the renderer also keeps recent cards in memory.
    "GET /api/news-desk/stories/:id/image.png": async (ctx) => {
      rateLimit(ctx, "news-desk-image", 120, 10 * 60_000);
      const id = String(ctx.params?.id || "");
      const story = /^[A-Za-z0-9-]{1,80}$/u.test(id) ? reader.get(id) : null;
      const model = story ? newsShareCardModel(story, { variant: "news-link" }) : null;
      if (!model) throw new ApiError(404, "That story is not available.", "NOT_FOUND");
      try {
        const rendered = await renderer.render(model, { signal: ctx.signal || null });
        return createPngApiResponse(rendered.bytes, { canonicalUrl: model.canonicalUrl, filename: "mshpit-news.png", publicMaxAgeSeconds: 3600 });
      } catch (error) {
        if (error instanceof SocialShareCardBusyError || error instanceof SocialShareCardArtworkUnavailableError) {
          throw new ApiError(503, "The story image is busy. Try again in a moment.", "SHARE_RENDER_UNAVAILABLE", error);
        }
        throw error;
      }
    },
  };
}
