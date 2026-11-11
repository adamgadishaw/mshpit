import { INCOMING_MESSAGE_PEERS_CTE, MESSAGE_PEERS_CTES } from "./features/messaging/directMessageThreads.js";

function readCursor(row) {
  return row?.last_read_id ? { createdAt: row.last_read_at, id: row.last_read_id } : null;
}

// Count and latest-incoming boundary belong to the same SQLite snapshot. Each
// correlated lookup uses the pair/cursor indexes, including the unread range;
// a thread poll never needs to scan every conversation in the account.
const READ_PROJECTION = `SELECT peers.other_id,r.last_read_at,r.last_read_id,
  (SELECT d.id FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
    ORDER BY d.created_at DESC,d.id DESC LIMIT 1) AS latest_incoming_id,
  (SELECT d.created_at FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
    ORDER BY d.created_at DESC,d.id DESC LIMIT 1) AS latest_incoming_at,
  EXISTS(SELECT 1 FROM dms sent WHERE sent.from_id=$viewer AND sent.to_id=peers.other_id AND sent.removed=0) AS has_replied,
  CASE WHEN r.user_id IS NULL THEN (
    SELECT COUNT(*) FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
  ) ELSE (
    SELECT COUNT(*) FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
      AND (d.created_at,d.id)>(r.last_read_at,r.last_read_id)
  ) END AS unread
  FROM peers LEFT JOIN dm_reads r ON r.user_id=$viewer AND r.other_id=peers.other_id`;

function readSummary(row) {
  return {
    readCursor: readCursor(row),
    unread: row?.unread || 0,
    latestIncomingCursor: row?.latest_incoming_id
      ? { createdAt: row.latest_incoming_at, id: row.latest_incoming_id } : null,
    hasReplied: !!row?.has_replied,
  };
}

export function directMessageReadFor(database, userId, otherId) {
  return readSummary(database.prepare(`WITH peers AS (SELECT $other AS other_id) ${READ_PROJECTION}`)
    .get({ $viewer: userId, $other: otherId }));
}

export function directMessageReadProjection(database, userId) {
  const rows = database.prepare(`WITH RECURSIVE ${MESSAGE_PEERS_CTES}, peers AS MATERIALIZED (
    SELECT other_id FROM message_peers
    UNION SELECT other_id FROM dm_reads WHERE user_id=$viewer
  ) ${READ_PROJECTION}`).all({ $viewer: userId });
  const summaries = new Map(rows.map(row => [row.other_id, readSummary(row)]));
  return {
    forOther(otherId) {
      return summaries.get(otherId) || readSummary(null);
    },
  };
}

// Count accepted incoming messages on the server, independently of the 200-row
// inbox summary and its one-message preview. Requests stay in their own bucket.
export function directMessageInboxUnread(database, accountId) {
  // Resolve acceptance/privacy and the read cursor once per sender, then count
  // that sender's unread index range. Do not recheck relationships per message
  // or scan an entire mostly-read history through a joined cursor predicate.
  // Durable directional consent survives unfollowing/removing message content;
  // retain follow/sent evidence for compatibility with legacy writers.
  return database.prepare(`WITH RECURSIVE ${INCOMING_MESSAGE_PEERS_CTE}, peers AS MATERIALIZED (
      SELECT other_id FROM incoming_peers WHERE other_id IS NOT NULL
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
    AND (EXISTS (SELECT 1 FROM dm_acceptances a WHERE a.user_id=$viewer AND a.other_id=peers.other_id)
      OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$viewer AND f.followee_id=peers.other_id)
      OR EXISTS (SELECT 1 FROM dms sent WHERE sent.from_id=$viewer AND sent.to_id=peers.other_id AND sent.removed=0))
  `).get({ $viewer: accountId }).count;
}

function markThreadRead(database, userId, otherId, target) {
  database.prepare(`INSERT INTO dm_reads (user_id,other_id,last_read_at,last_read_id) VALUES (?,?,?,?)
    ON CONFLICT(user_id,other_id) DO UPDATE SET
      last_read_at=excluded.last_read_at,last_read_id=excluded.last_read_id
    WHERE excluded.last_read_at>dm_reads.last_read_at
      OR (excluded.last_read_at=dm_reads.last_read_at AND excluded.last_read_id>dm_reads.last_read_id)`)
    .run(userId, otherId, target.created_at, target.id);
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
  return { ...directMessageReadFor(database, userId, otherId), notificationIds };
}

export function dmReadRoutes({ database, requireUser, userById, blockedEitherWay, atomicWrite, ApiError }) {
  const readThrough = (ctx) => {
    requireUser(ctx);
    const messageId = ctx.body?.messageId;
    if (typeof messageId !== "string" || !messageId.trim() || messageId.length > 200) {
      throw new ApiError(400, "Choose a message to mark as read.", "VALIDATION_FAILED");
    }
    return atomicWrite(() => {
      const user = requireUser(ctx);
      const otherId = ctx.params.otherId;
      if (!userById.get(otherId)) throw new ApiError(404, "No such user.");
      if (blockedEitherWay(user.id, otherId)) {
        throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
      }
      // Never trust a client timestamp, sender or cursor. A target must be an
      // existing inbound message in this exact authorized conversation.
      const target = database.prepare(`SELECT id,created_at FROM dms
        WHERE id=? AND from_id=? AND to_id=? AND from_id<>to_id AND removed=0`).get(messageId, otherId, user.id);
      if (!target) throw new ApiError(404, "This message isn't available.", "NOT_FOUND");
      return { ok: true, ...markThreadRead(database, user.id, otherId, target) };
    });
  };
  return {
    // New clients use the distinct path: an old server must fail safely instead
    // of silently interpreting a targeted receipt as its old mark-all request.
    "POST /api/dms/:otherId/read-through": readThrough,
    "POST /api/dms/:otherId/read": readThrough,
  };
}
