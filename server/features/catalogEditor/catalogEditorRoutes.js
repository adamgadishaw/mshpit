import { ApiError } from "../../errors.js";
import { createCatalogEditorService } from "./catalogEditorService.js";
import { readPublicCatalogEditorText } from "./catalogEditorRepository.js";

export function catalogEditorRoutes({ database, requireAdmin, rateLimit, decodedPathParam, now = Date.now }) {
  const service = createCatalogEditorService({ database, now });
  const type = ctx => {
    if (!["artist", "venue", "event"].includes(ctx.params?.type)) throw new ApiError(400, "Choose artists, venues or events.", "VALIDATION_FAILED");
    return ctx.params.type;
  };
  const key = ctx => decodedPathParam(ctx, "key", { max: 450, label: "catalog identity" });
  const completion = ctx => {
    if (![undefined, "true", "false"].includes(ctx.query?.completion) || (ctx.query?.completion === "true" && type(ctx) === "event")) {
      throw new ApiError(400, "Completion plans support artists and venues only.", "VALIDATION_FAILED");
    }
    return ctx.query?.completion === "true";
  };
  const staff = (ctx, write = false) => {
    const actor = requireAdmin(ctx);
    ctx.setHeader?.("Cache-Control", "private, no-store");
    if (write && !(actor.email_verified_at > 0)) throw new ApiError(403, "Confirm your email before editing catalog text.", "EMAIL_VERIFICATION_REQUIRED");
    rateLimit(ctx, write ? "catalog-editor-write" : "catalog-editor-read", write ? 30 : 60, 60_000);
    return actor;
  };
  return {
    "GET /api/admin/catalog-editor/:type": ctx => {
      staff(ctx);
      const after = ctx.query?.cursor || "", query = ctx.query?.q || "";
      if (typeof after !== "string" || after.length > 450 || typeof query !== "string" || query.length > 100
        || ![undefined, "true", "false"].includes(ctx.query?.missing)) throw new ApiError(400, "The catalog filter is invalid.", "VALIDATION_FAILED");
      return service.list({ type: type(ctx), after, query: query.trim(), missingOnly: ctx.query?.missing !== "false", completion: completion(ctx) });
    },
    "GET /api/admin/catalog-editor/:type/:key": ctx => { staff(ctx); return service.read({ type: type(ctx), key: key(ctx), completion: completion(ctx) }); },
    "POST /api/admin/catalog-editor/prepare": ctx => {
      staff(ctx, true);
      if (!ctx.body || Object.keys(ctx.body).some(field => field !== "entries")) throw new ApiError(400, "Prepare catalog entries only.", "VALIDATION_FAILED");
      return service.prepare(ctx.body.entries);
    },
    "POST /api/admin/catalog-editor/save": ctx => {
      const actor = staff(ctx, true);
      if (!ctx.body || Object.keys(ctx.body).some(field => !["draft", "idempotencyKey"].includes(field))) throw new ApiError(400, "Save the reviewed catalog draft only.", "VALIDATION_FAILED");
      ctx.assertCurrentSession?.();
      requireAdmin(ctx);
      return service.save({ actorId: actor.id, draft: ctx.body.draft, idempotencyKey: ctx.body.idempotencyKey, requestId: ctx.requestId || null });
    },
    "GET /api/catalog-text/:type/:key": ctx => {
      rateLimit(ctx, "catalog-research-read", 120, 60_000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return { text: readPublicCatalogEditorText(database, { type: type(ctx), key: key(ctx), at: now() }) };
    },
  };
}
