import { randomUUID } from "node:crypto";

import { hideCatalogResearch, readCatalogResearch } from "./catalogResearchService.js";

// Public reads of the research agent's sourced summaries, and the staff switch
// that takes a wrong one down. Reads never start research.
export function catalogResearchRoutes({ database, ApiError, rateLimit, decodedPathParam, resolveArtist, canonicalVenueKey,
  requireAdmin, now = Date.now }) {
  const audit = database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  // Private: some artist pages are visible only to certain accounts.
  const cache = (ctx) => ctx.setHeader?.("Cache-Control", "private, max-age=300");
  return {
    "GET /api/artists/:key/research": (ctx) => {
      rateLimit(ctx, "catalog-research-read", 120, 60_000);
      const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
      const artist = resolveArtist(key, ctx);
      if (!artist) throw new ApiError(404, "This artist page is unavailable.", "NOT_FOUND");
      cache(ctx);
      return { research: readCatalogResearch(database, { type: "artist", key: artist.norm }) };
    },
    "GET /api/venues/:key/research": (ctx) => {
      rateLimit(ctx, "catalog-research-read", 120, 60_000);
      const key = canonicalVenueKey(decodedPathParam(ctx, "key", { max: 200, label: "venue link" }));
      if (!key) throw new ApiError(400, "Choose a venue first.", "VALIDATION_FAILED");
      const city = typeof ctx.query?.city === "string" ? ctx.query.city.slice(0, 80) : null;
      cache(ctx);
      return { research: readCatalogResearch(database, { type: "venue", key, city }) };
    },
    "POST /api/moderation/catalog-research/hide": (ctx) => {
      const actor = requireAdmin(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "catalog-research-hide", 60, 600_000);
      const body = ctx.body;
      const type = body?.type;
      const key = typeof body?.key === "string" ? body.key.trim().slice(0, 600) : "";
      if (!["artist", "venue"].includes(type) || !key) {
        throw new ApiError(400, "Choose the artist or venue research to hide.", "VALIDATION_FAILED");
      }
      if (!hideCatalogResearch(database, { type, key, at: now() })) {
        throw new ApiError(404, "That research was not found.", "NOT_FOUND");
      }
      audit.run(randomUUID(), actor.id, "catalog_research_hide", "catalog", `${type}:${key}`.slice(0, 200),
        "staff hid researched page text", JSON.stringify({ visible: true }), JSON.stringify({ visible: false }),
        typeof ctx.requestId === "string" ? ctx.requestId : null, now());
      return { ok: true };
    },
  };
}
