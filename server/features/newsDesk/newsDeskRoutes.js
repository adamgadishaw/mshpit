// The news desk's stories are public, like any public post.
export function newsDeskRoutes({ rateLimit, reader }) {
  const decodeCursor = (value) => {
    const [createdAt, id] = String(value || "").split(".");
    const at = Number(createdAt);
    return Number.isSafeInteger(at) && at > 0 && id && id.length <= 80 ? { createdAt: at, id } : null;
  };
  return {
    "GET /api/news-desk/stories": (ctx) => {
      rateLimit(ctx, "news-desk", 240, 10 * 60_000);
      const result = reader.list({ limit: Number(ctx.query?.limit) || 20, before: decodeCursor(ctx.query?.cursor) });
      ctx.setHeader?.("Cache-Control", "public, max-age=120");
      return {
        stories: result.stories,
        nextCursor: result.nextCursor ? `${result.nextCursor.createdAt}.${result.nextCursor.id}` : null,
      };
    },
  };
}
