function readCursor(row) {
  return row ? { createdAt: row.last_read_at, id: row.last_read_id } : null;
}

export function directMessageReadProjection(database, userId) {
  const cursors = new Map(database.prepare(
    "SELECT other_id,last_read_at,last_read_id FROM dm_reads WHERE user_id=?",
  ).all(userId).map((row) => [row.other_id, readCursor(row)]));
  const unread = new Map(database.prepare(`SELECT d.from_id AS other_id,COUNT(*) AS count
    FROM dms d LEFT JOIN dm_reads r ON r.user_id=d.to_id AND r.other_id=d.from_id
    WHERE d.to_id=? AND d.removed=0 AND (
      r.user_id IS NULL OR d.created_at>r.last_read_at OR (d.created_at=r.last_read_at AND d.id>r.last_read_id)
    ) GROUP BY d.from_id`).all(userId).map((row) => [row.other_id, row.count]));
  return {
    forOther(otherId) {
      return { readCursor: cursors.get(otherId) || null, unread: unread.get(otherId) || 0 };
    },
  };
}

function markThreadRead(database, atomicWrite, userId, otherId) {
  return atomicWrite(() => {
    const latest = database.prepare(`SELECT id,created_at FROM dms
      WHERE from_id=? AND to_id=? AND removed=0
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(otherId, userId);
    if (!latest) {
      const existing = database.prepare("SELECT last_read_at,last_read_id FROM dm_reads WHERE user_id=? AND other_id=?")
        .get(userId, otherId);
      return { readCursor: readCursor(existing), notificationIds: [] };
    }

    database.prepare(`INSERT INTO dm_reads (user_id,other_id,last_read_at,last_read_id) VALUES (?,?,?,?)
      ON CONFLICT(user_id,other_id) DO UPDATE SET
        last_read_at=excluded.last_read_at,last_read_id=excluded.last_read_id
      WHERE excluded.last_read_at>dm_reads.last_read_at
        OR (excluded.last_read_at=dm_reads.last_read_at AND excluded.last_read_id>dm_reads.last_read_id)`)
      .run(userId, otherId, latest.created_at, latest.id);
    const saved = database.prepare("SELECT last_read_at,last_read_id FROM dm_reads WHERE user_id=? AND other_id=?")
      .get(userId, otherId);
    const notificationIds = database.prepare(`SELECT n.id FROM notifications n JOIN dms d ON d.id=n.post_id
      WHERE n.user_id=? AND n.actor_id=? AND n.type='dm' AND n.read=0
        AND d.from_id=? AND d.to_id=?
        AND (d.created_at<? OR (d.created_at=? AND d.id<=?))`)
      .all(userId, otherId, otherId, userId, saved.last_read_at, saved.last_read_at, saved.last_read_id)
      .map((row) => row.id);
    database.prepare(`UPDATE notifications SET read=1 WHERE user_id=? AND actor_id=? AND type='dm' AND read=0
      AND EXISTS (SELECT 1 FROM dms d WHERE d.id=notifications.post_id
        AND d.from_id=? AND d.to_id=?
        AND (d.created_at<? OR (d.created_at=? AND d.id<=?)))`)
      .run(userId, otherId, otherId, userId, saved.last_read_at, saved.last_read_at, saved.last_read_id);
    return { readCursor: readCursor(saved), notificationIds };
  });
}

export function dmReadRoutes({ database, requireUser, userById, blockedEitherWay, atomicWrite, ApiError }) {
  return {
    "POST /api/dms/:otherId/read": (ctx) => {
      const user = requireUser(ctx);
      const otherId = ctx.params.otherId;
      if (!userById.get(otherId)) throw new ApiError(404, "No such user.");
      if (blockedEitherWay(user.id, otherId)) {
        throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
      }
      return { ok: true, ...markThreadRead(database, atomicWrite, user.id, otherId) };
    },
  };
}
