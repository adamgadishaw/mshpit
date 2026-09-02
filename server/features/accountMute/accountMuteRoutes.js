export function accountMuteRoutes({ database, ApiError, requireUser, rateLimit, now, desiredState, userById, projectUser, invalidateRecommendations }) {
  const mutedBy = (muterId, mutedId) => !!database.prepare(
    "SELECT 1 FROM account_mutes WHERE muter_id=? AND muted_id=?",
  ).get(muterId, mutedId);
  return {
    "POST /api/users/:id/mute": (ctx) => {
      const user = requireUser(ctx);
      rateLimit(ctx, "mute", 60, 10 * 60 * 1000);
      const other = ctx.params.id;
      if (other === user.id) throw new ApiError(400, "You can't mute yourself.", "VALIDATION_FAILED");
      if (!userById(other)) throw new ApiError(404, "No such user.", "NOT_FOUND");
      const has = mutedBy(user.id, other);
      const muted = desiredState(ctx.body, "muted", has);
      if (muted && !has) database.prepare("INSERT INTO account_mutes (muter_id,muted_id,created_at) VALUES (?,?,?)").run(user.id, other, now());
      else if (!muted && has) database.prepare("DELETE FROM account_mutes WHERE muter_id=? AND muted_id=?").run(user.id, other);
      invalidateRecommendations(user.id);
      return { muted };
    },
    "GET /api/me/muted": (ctx) => {
      const user = requireUser(ctx);
      const rows = database.prepare(`SELECT us.* FROM account_mutes mute JOIN users us ON us.id=mute.muted_id
        WHERE mute.muter_id=? ORDER BY mute.created_at DESC LIMIT 500`).all(user.id);
      return { users: rows.map(projectUser) };
    },
  };
}
