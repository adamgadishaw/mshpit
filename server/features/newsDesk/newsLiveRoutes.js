import { randomUUID } from "node:crypto";
import { addLiveNote, endLiveEvent, liveEventBySlug, markLiveWinner, NewsLiveError, publicLiveCoverage, removeLiveNote, setLiveCategories, staffLiveCoverage, startLiveEvent } from "./newsLive.js";

// Live coverage (newsLive.js): a public timeline, and owner/admin controls to
// start it, post short updates, remove one, and end it. No Claude calls.
export function newsLiveRoutes({ database, ApiError, requireAdmin, rateLimit, now = Date.now }) {
  const audit = database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const writer = (ctx) => {
    const actor = requireAdmin(ctx);
    ctx.setHeader?.("Cache-Control", "private, no-store");
    if (!(actor.email_verified_at > 0)) throw new ApiError(403, "Confirm your email before running live coverage.", "EMAIL_VERIFICATION_REQUIRED");
    rateLimit(ctx, "news-live-write", 120, 3_600_000);
    return actor;
  };
  const record = (ctx, actor, action, targetId, reason) => audit.run(randomUUID(), actor.id, action, "news_live", targetId,
    String(reason || action).slice(0, 200), "{}", "{}", ctx.requestId || null, now());
  const body = (ctx, allowed) => {
    const value = ctx.body ?? {};
    if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
      throw new ApiError(400, "That request is not in the expected shape.", "VALIDATION_FAILED");
    }
    return value;
  };
  const run = (work) => {
    try { return work(); }
    catch (error) {
      if (!(error instanceof NewsLiveError)) throw error;
      switch (error.code) {
        case "VALIDATION_FAILED": throw new ApiError(400, error.message, "VALIDATION_FAILED");
        case "NOT_FOUND": throw new ApiError(404, error.message, "NOT_FOUND");
        case "CONFLICT": throw new ApiError(409, error.message, "CONFLICT");
        default: throw new ApiError(500, "Something broke on our end, it's been logged.", "INTERNAL_ERROR", error);
      }
    }
  };
  const staffView = () => ({ live: staffLiveCoverage(database, { at: now() }) });

  return {
    "GET /api/news-desk/live": (ctx) => {
      rateLimit(ctx, "news-live", 240, 600_000);
      ctx.setHeader?.("Cache-Control", "public, max-age=30");
      return publicLiveCoverage(database, { at: now() });
    },
    // One event's full page in the app (/news/live/<slug>), live or not.
    "GET /api/news-desk/live/:slug": (ctx) => {
      rateLimit(ctx, "news-live", 240, 600_000);
      ctx.setHeader?.("Cache-Control", "public, max-age=30");
      const event = liveEventBySlug(database, String(ctx.params?.slug || "").toLowerCase(), { at: now() });
      if (!event) throw new ApiError(404, "That coverage is not available.", "NOT_FOUND");
      return { event };
    },
    "POST /api/moderation/news-desk/live": (ctx) => run(() => {
      const actor = writer(ctx);
      const { title, keywords, hours, startsAt } = body(ctx, ["title", "keywords", "hours", "startsAt"]);
      const event = startLiveEvent(database, { title, keywords, hours, startsAt: startsAt ?? null, actorId: actor.id, at: now() });
      record(ctx, actor, "news_live_started", event.id, event.title);
      console.log(`[news-desk] live coverage started: "${event.title}" until ${new Date(event.ends_at).toISOString()}`);
      return staffView();
    }),
    "POST /api/moderation/news-desk/live/:id/notes": (ctx) => run(() => {
      const actor = writer(ctx);
      const { text, url } = body(ctx, ["text", "url"]);
      const noteId = addLiveNote(database, String(ctx.params?.id || ""), { text, url: url || null, actorId: actor.id, at: now() });
      record(ctx, actor, "news_live_update", noteId, text);
      return staffView();
    }),
    "POST /api/moderation/news-desk/live/:id/categories": (ctx) => run(() => {
      const actor = writer(ctx);
      const { text } = body(ctx, ["text"]);
      if (typeof text !== "string" || text.length > 20_000) throw new ApiError(400, "Paste the categories as text, up to 20,000 characters.", "VALIDATION_FAILED");
      const count = setLiveCategories(database, String(ctx.params?.id || ""), text, { at: now() });
      record(ctx, actor, "news_live_categories", String(ctx.params?.id || ""), `${count} categories`);
      return staffView();
    }),
    "POST /api/moderation/news-desk/live/:id/categories/:categoryId/winner": (ctx) => run(() => {
      const actor = writer(ctx);
      const { nominee } = body(ctx, ["nominee"]);
      if (nominee !== null && (typeof nominee !== "string" || !nominee.trim() || nominee.length > 160)) {
        throw new ApiError(400, "Pick a nominee, or clear the winner.", "VALIDATION_FAILED");
      }
      const winner = markLiveWinner(database, String(ctx.params?.id || ""), String(ctx.params?.categoryId || ""), nominee, { actorId: actor.id, at: now() });
      record(ctx, actor, winner ? "news_live_winner" : "news_live_winner_cleared", String(ctx.params?.categoryId || ""), winner || "cleared");
      return staffView();
    }),
    "POST /api/moderation/news-desk/live/:id/end": (ctx) => run(() => {
      const actor = writer(ctx);
      const event = endLiveEvent(database, String(ctx.params?.id || ""), { at: now() });
      record(ctx, actor, "news_live_ended", event.id, event.title);
      return staffView();
    }),
    "POST /api/moderation/news-desk/live/notes/:id/remove": (ctx) => run(() => {
      const actor = writer(ctx);
      removeLiveNote(database, String(ctx.params?.id || ""), { at: now() });
      record(ctx, actor, "news_live_update_removed", String(ctx.params?.id || ""), "removed a live update");
      return staffView();
    }),
  };
}
