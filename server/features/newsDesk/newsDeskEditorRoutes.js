import { randomUUID } from "node:crypto";
import { NewsEditorError } from "./newsDeskEditor.js";
import { ensureNewsLiveSchema, staffLiveCoverage } from "./newsLive.js";
import { ensureNewsCardPhotoSchema, readNewsCardPhotoChoice, setNewsCardPhotoChoice } from "./newsCardPhotos.js";
import { newsCardPhotoOptions } from "./newsCardArtwork.js";

// Owner/admin controls for writing a story on demand (newsDeskEditor.js).
// Reading and searching never call Claude; a draft is one metered call.
export function newsDeskEditorRoutes({ editor, database, ApiError, requireAdmin, rateLimit, now = Date.now,
  photoResolver = null, readStory = () => null, listStories = () => [] }) {
  ensureNewsLiveSchema(database);
  ensureNewsCardPhotoSchema(database);
  // Recent stories and the photos their share cards can use.
  const storyPhotos = () => (typeof photoResolver === "function" ? listStories().slice(0, 10).map((story) => ({
    postId: story.postId,
    headline: story.headline,
    publishedAt: story.publishedAt,
    photo: readNewsCardPhotoChoice(database, story.postId),
    options: newsCardPhotoOptions(story, photoResolver),
    current: photoResolver(story).fallbackArtwork?.[0]?.url || null,
  })) : []);
  const audit = database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "private, no-store");
  const writer = (ctx) => {
    const actor = requireAdmin(ctx);
    noStore(ctx);
    if (!(actor.email_verified_at > 0)) throw new ApiError(403, "Confirm your email before writing news.", "EMAIL_VERIFICATION_REQUIRED");
    return actor;
  };
  const record = (ctx, actor, action, draft) => audit.run(randomUUID(), actor.id, action, "news_draft", draft.id,
    draft.headline ? draft.headline.slice(0, 200) : action, "{}", JSON.stringify({ status: draft.status, costUsd: draft.costUsd }), ctx.requestId || null, now());
  const run = async (work) => {
    try { return await work(); }
    catch (error) {
      if (!(error instanceof NewsEditorError)) throw error;
      switch (error.code) {
        case "VALIDATION_FAILED": throw new ApiError(400, error.message, "VALIDATION_FAILED");
        case "NOT_FOUND": throw new ApiError(404, error.message, "NOT_FOUND");
        case "CONFLICT": throw new ApiError(409, error.message, "CONFLICT");
        case "ACTION_REQUIRED": throw new ApiError(422, error.message, "ACTION_REQUIRED");
        case "RATE_LIMITED": throw new ApiError(429, error.message, "RATE_LIMITED");
        case "PROVIDER_UNAVAILABLE": throw new ApiError(502, error.message, "PROVIDER_UNAVAILABLE", error.cause);
        default: throw new ApiError(500, "Something broke on our end, it's been logged.", "INTERNAL_ERROR", error);
      }
    }
  };
  const body = (ctx, allowed) => {
    const value = ctx.body;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
      throw new ApiError(400, "That request is not in the expected shape.", "VALIDATION_FAILED");
    }
    return value;
  };

  return {
    "GET /api/moderation/news-desk/editor": (ctx) => run(() => {
      requireAdmin(ctx);
      noStore(ctx);
      const query = typeof ctx.query?.q === "string" && ctx.query.q.trim() ? ctx.query.q : null;
      rateLimit(ctx, query ? "news-editor-search" : "news-editor-read", query ? 60 : 120, 600_000);
      return editor.overview({ query }).then((overview) => ({ ...overview, live: staffLiveCoverage(database, { at: now() }), stories: storyPhotos() }));
    }),
    // The share card photo for a story: auto, one of its artists, or none.
    "PUT /api/moderation/news-desk/editor/stories/:postId/photo": (ctx) => run(() => {
      const actor = requireAdmin(ctx);
      noStore(ctx);
      rateLimit(ctx, "news-editor-photo", 60, 600_000);
      const postId = String(ctx.params?.postId || "");
      const { choice, artistKey } = body(ctx, ["choice", "artistKey"]);
      if (!["auto", "artist", "none"].includes(choice)) throw new ApiError(400, "Choose auto, an artist, or no photo.", "VALIDATION_FAILED");
      const result = setNewsCardPhotoChoice(database, { postId, choice, artistKey: typeof artistKey === "string" ? artistKey : null,
        story: readStory(postId), actorId: actor.id, at: now() });
      if (result.error === "NOT_FOUND") throw new ApiError(404, "That story is no longer published.", "NOT_FOUND");
      if (result.error) throw new ApiError(400, "Pick one of the artists in this story.", "VALIDATION_FAILED");
      return { photo: result };
    }),
    "POST /api/moderation/news-desk/editor/drafts": (ctx) => run(async () => {
      const actor = writer(ctx);
      rateLimit(ctx, "news-editor-draft", 12, 3_600_000);
      const { reportUrls, links } = body(ctx, ["reportUrls", "links"]);
      const draft = await editor.draft({ reportUrls, links, actorId: actor.id, signal: ctx.signal || null,
        onSaved: (saved) => record(ctx, actor, "news_draft_written", saved) });
      return { draft };
    }),
    "POST /api/moderation/news-desk/editor/drafts/:id/publish": (ctx) => run(() => {
      const actor = writer(ctx);
      rateLimit(ctx, "news-editor-publish", 20, 3_600_000);
      const result = editor.publish(String(ctx.params?.id || ""), {
        onPublished: (published) => record(ctx, actor, "news_draft_published", published.draft),
      });
      console.log(`[news-desk] owner published "${result.draft.headline.slice(0, 90)}" post=${result.postId}`);
      return result;
    }),
    "POST /api/moderation/news-desk/editor/drafts/:id/discard": (ctx) => run(() => {
      const actor = writer(ctx);
      rateLimit(ctx, "news-editor-discard", 60, 3_600_000);
      const draft = editor.discard(String(ctx.params?.id || ""), {
        onDiscarded: (discarded) => record(ctx, actor, "news_draft_discarded", discarded),
      });
      return { draft };
    }),
  };
}
