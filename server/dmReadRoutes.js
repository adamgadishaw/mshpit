function readCursor(row) {
  return row ? { createdAt: row.last_read_at, id: row.last_read_id } : null;
}

export function directMessageReadProjection(database, userId) {
  // Acceptance depends on all retained outgoing history, not the latest preview.
  const repliedPeers = new Set(database.prepare(
    "SELECT DISTINCT to_id FROM dms WHERE from_id=? AND removed=0",
  ).all(userId).map((row) => row.to_id));
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
      return { readCursor: cursors.get(otherId) || null, unread: unread.get(otherId) || 0, hasReplied: repliedPeers.has(otherId) };
    },
  };
}

// Count accepted incoming messages on the server, independently of the 200-row
// inbox summary and its one-message preview. Requests stay in their own bucket.
export function directMessageInboxUnread(database, accountId) {
  // Resolve acceptance/privacy and the read cursor once per sender, then count
  // that sender's unread index range. Do not recheck relationships per message
  // or scan an entire mostly-read history through a joined cursor predicate.
  return database.prepare(`WITH peers AS MATERIALIZED (
      SELECT DISTINCT from_id AS other_id FROM dms WHERE to_id=$viewer
    ) SELECT COALESCE(SUM(CASE WHEN r.user_id IS NULL THEN (
        SELECT COUNT(*) FROM dms d WHERE d.to_id=$viewer AND d.from_id=peers.other_id AND d.removed=0
      ) ELSE (
        SELECT COUNT(*) FROM dms d WHERE d.to_id=$viewer AND d.from_id=peers.other_id AND d.removed=0
          AND (d.created_at,d.id)>(r.last_read_at,r.last_read_id)
      ) END),0) AS count FROM peers
    JOIN users actor ON actor.id=peers.other_id
    LEFT JOIN dm_reads r ON r.user_id=$viewer AND r.other_id=peers.other_id
    WHERE NOT EXISTS (SELECT 1 FROM blocks b
      WHERE (b.blocker_id=$viewer AND b.blocked_id=peers.other_id)
         OR (b.blocker_id=peers.other_id AND b.blocked_id=$viewer))
    AND (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$viewer AND f.followee_id=peers.other_id)
      OR EXISTS (SELECT 1 FROM dms sent WHERE sent.from_id=$viewer AND sent.to_id=peers.other_id AND sent.removed=0))
  `).get({ $viewer: accountId }).count;
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
