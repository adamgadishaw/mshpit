import { randomUUID } from "node:crypto";

const MODES = new Set(["paused", "catch_up", "maintenance"]);

// Controls persist desired state only. HTTP requests never start a download,
// reset quotas/cooldowns, or accept provider URLs, credentials, or SQL.
export function catalogMaintenanceRoutes({ database, ApiError, requireAdmin, rateLimit,
  collectStatus, inspectControl, setControl, now = Date.now }) {
  const audit = database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const headers = (ctx) => ctx.setHeader?.("Cache-Control", "private, no-store");
  return {
    "GET /api/moderation/catalog-maintenance": (ctx) => {
      requireAdmin(ctx);
      headers(ctx);
      rateLimit(ctx, "catalog-maintenance-read", 120, 600_000);
      return collectStatus();
    },
    "POST /api/moderation/catalog-maintenance": (ctx) => {
      const actor = requireAdmin(ctx);
      headers(ctx);
      if (!(actor.email_verified_at > 0)) throw new ApiError(403, "Confirm your email before changing catalog upkeep.", "EMAIL_VERIFICATION_REQUIRED");
      rateLimit(ctx, "catalog-maintenance-write", 20, 600_000);
      const body = ctx.body;
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => !["mode", "expectedMode"].includes(key))
        || !MODES.has(body.mode)
        || (Object.hasOwn(body, "expectedMode") && !MODES.has(body.expectedMode))) {
        throw new ApiError(400, "Choose catch-up, maintenance, or paused.", "VALIDATION_FAILED");
      }
      database.exec("SAVEPOINT catalog_maintenance_control");
      try {
        const before = inspectControl();
        if (body.expectedMode && body.expectedMode !== before.mode && body.mode !== before.mode) {
          throw new ApiError(409, "Catalog upkeep changed. Refresh its status before saving.", "CONFLICT");
        }
        if (before.mode !== body.mode) {
          setControl(body.mode);
          audit.run(randomUUID(), actor.id, "catalog_maintenance_mode", "catalog", "artist-knowledge",
            "Changed bounded catalog upkeep mode", JSON.stringify({ mode: before.mode }),
            JSON.stringify({ mode: body.mode }), ctx.requestId || null, now());
        }
        database.exec("RELEASE catalog_maintenance_control");
      } catch (error) {
        database.exec("ROLLBACK TO catalog_maintenance_control; RELEASE catalog_maintenance_control");
        throw error;
      }
      return collectStatus();
    },
  };
}
