import { createHash } from "node:crypto";
import { isPassword } from "../../../src/domain/validation.mjs";

export function accountSecurityRoutes({ database, ApiError, requireSessionUser, limit, verifyPassword,
  hashPassword, atomicWrite, createSession, cancelSignup, proveAndGrant = () => {} }) {
  return {
    "POST /api/me/password": (ctx) => {
      const actor = requireSessionUser(ctx);
      limit(ctx, "change-password", 5, 15 * 60 * 1000);
      ctx.setHeader?.("Cache-Control", "no-store");
      const user = database.prepare("SELECT * FROM users WHERE id=?").get(actor.id);
      if (typeof ctx.body?.currentPassword !== "string" || ctx.body.currentPassword.length > 100
        || !verifyPassword(ctx.body.currentPassword, user?.pass_hash)) {
        throw new ApiError(401, "Your current password doesn't match this account.", "AUTH_INVALID");
      }
      if (!isPassword(ctx.body?.password)) throw new ApiError(400, "Use 8–100 characters with letters and numbers.", "VALIDATION_FAILED");
      const replacement = hashPassword(ctx.body.password);
      const session = atomicWrite(() => {
        const changed = database.prepare(`UPDATE users SET pass_hash=?,reset_hash=NULL,reset_expires=0,signup_cancel_hash=NULL
          WHERE id=? AND pass_hash=?`).run(replacement, user.id, user.pass_hash).changes;
        if (changed !== 1) throw new ApiError(409, "Your password changed elsewhere. Log in again.", "CONFLICT");
        database.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        return createSession(user.id, ctx.ip, ctx.ua);
      });
      proveAndGrant({ userId: user.id, password: ctx.body.password, token: session.token });
      ctx.setSession(session);
      return { ok: true, accountId: user.id };
    },
    // The capability is random, returned identically for duplicate signup, and
    // only lives in the initiating form's memory. It never authorizes login.
    "POST /api/signup/cancel": (ctx) => {
      limit(ctx, "cancel-signup", 10, 15 * 60 * 1000);
      ctx.setHeader?.("Cache-Control", "no-store");
      const token = ctx.body?.cancelToken;
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(400, "Reopen signup to cancel it.", "VALIDATION_FAILED");
      const hash = createHash("sha256").update(token).digest("hex");
      const user = database.prepare("SELECT * FROM users WHERE signup_cancel_hash=? AND onboarding_version=0").get(hash);
      if (user) cancelSignup(user, ctx, hash);
      return { ok: true };
    },
  };
}
