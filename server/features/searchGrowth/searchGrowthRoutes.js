import { randomUUID } from "node:crypto";
const MODES = new Set(["paused", "monitor", "prioritize"]);

// Status and desired state only: no HTTP handler triggers a Google request.
export function searchGrowthRoutes({ database, service, ApiError, requireAdmin, rateLimit, now = Date.now }) {
  const audit = database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const headers = ctx => ctx.setHeader?.("Cache-Control", "private, no-store");
  return {
    "GET /api/moderation/search-growth": ctx => {
      headers(ctx);
      requireAdmin(ctx);
      rateLimit(ctx, "search-growth-read", 120, 600_000);
      return service.collectStatus();
    },
    "POST /api/moderation/search-growth": ctx => {
      headers(ctx);
      const actor = requireAdmin(ctx);
      if (!(actor.email_verified_at > 0)) throw new ApiError(403, "Confirm your email before changing search monitoring.", "EMAIL_VERIFICATION_REQUIRED");
      rateLimit(ctx, "search-growth-write", 20, 600_000);
      const body = ctx.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["mode", "expectedMode"].includes(key))
        || !Object.hasOwn(body, "mode") || !MODES.has(body.mode) || !Object.hasOwn(body, "expectedMode") || !MODES.has(body.expectedMode)) {
        throw new ApiError(400, "Choose paused, monitor, or prioritize.", "VALIDATION_FAILED");
      }
      database.exec("SAVEPOINT search_growth_control");
      try {
        const before = service.collectStatus();
        if (body.expectedMode && body.expectedMode !== before.mode && body.mode !== before.mode) {
          throw new ApiError(409, "Search monitoring changed. Refresh before saving.", "CONFLICT");
        }
        if (before.mode !== body.mode) {
          service.setMode(body.mode);
          audit.run(randomUUID(), actor.id, "search_growth_mode", "search-growth", "search-console",
            "Changed bounded search monitoring mode", JSON.stringify({ mode: before.mode }), JSON.stringify({ mode: body.mode }),
            typeof ctx.requestId === "string" ? ctx.requestId.slice(0, 100) : null, now());
        }
        database.exec("RELEASE search_growth_control");
      } catch (error) { database.exec("ROLLBACK TO search_growth_control; RELEASE search_growth_control"); throw error; }
      return service.collectStatus();
    },
  };
}
