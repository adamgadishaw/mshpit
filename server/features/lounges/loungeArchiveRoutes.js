export function loungeArchiveRoutes({
  database,
  ApiError,
  decodeKey,
  finishPage,
  lifecycleService,
  now,
  pageRequest,
  requireModerator,
} = {}) {
  if (!database?.prepare || typeof ApiError !== "function" || typeof decodeKey !== "function"
    || typeof finishPage !== "function" || !lifecycleService?.snapshot || typeof now !== "function"
    || typeof pageRequest !== "function" || typeof requireModerator !== "function") {
    throw new TypeError("Lounge archive routes require complete moderation boundaries");
  }

  return Object.freeze({
    // Closed messages are never returned by member Lounge routes. This separate
    // no-store boundary is for authorized moderation/legal review only.
    "GET /api/mod/lounges/:key/archive": (ctx) => {
      requireModerator(ctx);
      ctx.setHeader?.("Cache-Control", "no-store");
      const key = decodeKey(ctx);
      if (!key) throw new ApiError(400, "Bad lounge.", "VALIDATION_FAILED");
      const lifecycle = lifecycleService.snapshot(key, now());
      const { cursor, limit } = pageRequest(ctx, 300, 300);
      const cursorSql = cursor ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
      const args = cursor
        ? [key, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
        : [key, limit + 1];
      const found = database.prepare(`SELECT m.*,u.name,u.handle,u.role FROM lounge_messages m
        LEFT JOIN users u ON u.id=m.user_id
        WHERE m.lounge_id=? ${cursorSql}
        ORDER BY m.created_at DESC,m.id DESC LIMIT ?`).all(...args);
      const page = finishPage(found, limit);
      return {
        lifecycle: {
          status: lifecycle.status,
          cutoffAt: lifecycle.cutoffAt,
          cutoffSource: lifecycle.cutoffSource,
          archived: lifecycle.archived,
          retentionPolicyKey: lifecycle.retentionPolicyKey,
          retentionReviewAt: lifecycle.retentionReviewAt,
        },
        messages: page.rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          name: row.name || null,
          handle: row.handle || null,
          role: row.role || null,
          text: row.text,
          removed: !!row.removed,
          createdAt: row.created_at,
        })),
        nextCursor: page.nextCursor,
      };
    },
  });
}
