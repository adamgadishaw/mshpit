import { ApiError } from "../../errors.js";
import { resolveAlertHomeCity } from "./localAlertPolicy.js";

export function localAlertRoutes({ requireUser, alerts, devices, sessionHashForRequest }) {
  const account = ctx => { ctx.setHeader?.("Cache-Control", "private, no-store"); return requireUser(ctx); };
  // A fresh authorization guard is mandatory for commands. Never substitute
  // the earlier ctx.user snapshot after body parsing/async work.
  const guard = ctx => {
    if (typeof ctx.assertCurrentSession !== "function") throw new ApiError(401, "Log in again.", "AUTH_REQUIRED");
    return ctx.assertCurrentSession;
  };
  return {
    "GET /api/me/local-alerts/preferences": ctx => {
      const member = account(ctx);
      return { preferences: alerts.preferences(member.id), homeCity: resolveAlertHomeCity(member.home_city) };
    },
    "PUT /api/me/local-alerts/preferences": ctx => {
      const member = account(ctx);
      return { preferences: alerts.setPreferences(member.id, ctx.body, guard(ctx)) };
    },
    "POST /api/me/local-alerts/devices": ctx => {
      const member = account(ctx);
      return devices.register(member.id, ctx.body, { assertCurrentSession: guard(ctx), sessionHash: sessionHashForRequest(ctx) });
    },
    "POST /api/me/local-alerts/devices/binding": ctx => {
      const member = account(ctx);
      return devices.binding(member.id, ctx.body, guard(ctx));
    },
    "DELETE /api/me/local-alerts/devices": ctx => {
      const member = account(ctx);
      return devices.revoke(member.id, ctx.body, guard(ctx));
    },
    "GET /api/me/local-alerts/:id/target": ctx => {
      const member = account(ctx);
      const target = alerts.readAlertTarget(member.id, ctx.params.id);
      if (!target) throw new ApiError(404, "This show update is no longer available.", "NOT_FOUND");
      return { target };
    },
  };
}
