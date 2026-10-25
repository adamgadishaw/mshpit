import { createHash } from "node:crypto";
import { normalizedTourDateStart } from "../../tourDateLifecycle.js";

const queryKey = (query) => createHash("sha256").update(query).digest("hex").slice(0, 24);
// An explicit read of stored upcoming facts. No provider resolution or refresh.
export function catalogSearchRoutes({ ApiError, now, rateLimit, readPage, project }) {
  const invalid = () => new ApiError(400, "That search page is invalid. Start the search again.", "VALIDATION_FAILED");
  return {
    "GET /api/search/events": (ctx) => {
      rateLimit(ctx, "catalog-search", 60, 60_000);
      const input = ctx.query || {};
      if (Object.keys(input).some(key => !["q", "after", "limit"].includes(key))
        || typeof input.q !== "string" || input.q.length > 80) throw invalid();
      const search = input.q.replace(/\s+/gu, " ").trim().toLowerCase();
      const requested = input.limit == null ? 24 : Number(input.limit);
      if (search.length < 2 || search.split(" ").length > 8 || /[\u0000-\u001f\u007f]/u.test(search)
        || !Number.isSafeInteger(requested) || requested < 1) throw invalid();
      const limit = Math.min(24, requested);
      const key = queryKey(search);
      let after = null;
      if (input.after) {
        try {
          if (typeof input.after !== "string" || input.after.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(input.after)) throw invalid();
          const cursor = JSON.parse(Buffer.from(input.after, "base64url").toString("utf8"));
          if (cursor.key !== key || typeof cursor.date !== "string" || normalizedTourDateStart(cursor.date) !== cursor.date
            || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 180 || cursor.id.trim() !== cursor.id || /[\u0000-\u001f\u007f]/u.test(cursor.id)) throw invalid();
          after = { date: cursor.date, id: cursor.id };
        } catch { throw invalid(); }
      }
      // Always use public publication scope, even for an owner or administrator;
      // the current viewer's block graph is an additional exclusion only.
      const page = readPage({ limit, through: null, search, blockedViewerId: ctx.user?.id || null, after }, now());
      const position = page.nextCursor ? JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8")) : null;
      return {
        events: page.rows.map(project),
        nextCursor: position ? Buffer.from(JSON.stringify({
          key, date: position[0], id: position[1],
        })).toString("base64url") : null,
      };
    },
  };
}
