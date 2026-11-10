import { directMessageInboxUnread } from "../../dmReadRoutes.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { SOCIAL_NOTIFICATION_VISIBLE_SQL } from "../socialReactions/socialReactions.js";

const READ_CONTRACT = "notification-ids-v1";
const MAX_ACKNOWLEDGEMENTS = 100;
// The same visibility rule governs rows, totals and acknowledgements. Apply it
// before LIMIT so hidden actors cannot consume a page or its continuation slot.
const VISIBLE_SQL = `${SOCIAL_NOTIFICATION_VISIBLE_SQL}
  AND (n.actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM blocks b WHERE (b.blocker_id=n.user_id AND b.blocked_id=n.actor_id)
      OR (b.blocker_id=n.actor_id AND b.blocked_id=n.user_id)
  )) AND (n.actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM account_mutes mute WHERE mute.muter_id=n.user_id AND mute.muted_id=n.actor_id
  ))`;

export function notificationRoutes({ database, requireUser, ApiError, pageRequest, finishPage, safePublicProfileImage }) {
  const unread = (accountId) => database.prepare(`SELECT COUNT(*) c FROM notifications n
    WHERE n.user_id=$viewer AND n.read=0 AND ${VISIBLE_SQL}`).get({ $viewer: accountId }).c;

  const acknowledge = (ctx) => {
    const account = requireUser(ctx);
    ctx.setHeader?.("Cache-Control", "private, no-store");
    const body = ctx.body;
    const invalid = () => { throw new ApiError(400, "Choose up to 100 notification IDs.", "VALIDATION_FAILED"); };
    if (body != null && (typeof body !== "object" || Array.isArray(body))) invalid();
    // Old clients sent no IDs. Succeed without changing anything rather than
    // reviving unsafe mark-all behavior during a mixed-version rollout.
    const requested = body?.notificationIds === undefined ? [] : body.notificationIds;
    if (!Array.isArray(requested) || requested.length > MAX_ACKNOWLEDGEMENTS
      || requested.some((id) => typeof id !== "string" || !id.length || id.length > 100 || id.trim() !== id)) invalid();
    const ids = [...new Set(requested)];
    return withImmediateWrite(database, () => {
      let confirmed = [];
      if (ids.length) {
        const bindings = { $viewer: account.id };
        const placeholders = ids.map((id, index) => {
          const key = `$notification${index}`;
          bindings[key] = id;
          return key;
        }).join(",");
        const visible = new Set(database.prepare(`SELECT n.id FROM notifications n
          WHERE n.user_id=$viewer AND n.id IN (${placeholders}) AND ${VISIBLE_SQL}`).all(bindings).map((row) => row.id));
        confirmed = ids.filter((id) => visible.has(id));
        const markRead = database.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND id=? AND read=0");
        for (const id of confirmed) markRead.run(account.id, id);
      }
      // Include already-read visible IDs: retrying a response lost after commit
      // must still let the client reconcile the exact acknowledged set.
      return { ok: true, readContract: READ_CONTRACT, notificationIds: confirmed, unread: unread(account.id) };
    });
  };

  return {
    "GET /api/me/notifications": (ctx) => {
      const account = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const { cursor, limit } = pageRequest(ctx, 100, 100);
      const cursorSql = cursor ? "AND (n.created_at < $before OR (n.created_at = $before AND n.id < $id))" : "";
      const args = { $viewer: account.id, $limit: limit + 1,
        ...(cursor ? { $before: cursor.createdAt, $id: cursor.id } : {}) };
      const found = database.prepare(`SELECT n.*, a.name AS actor_name, a.initials AS actor_initials,
          a.avatar_uri AS actor_uri, a.avatar_color AS actor_color
        FROM notifications n LEFT JOIN users a ON a.id=n.actor_id
        WHERE n.user_id=$viewer AND ${VISIBLE_SQL} ${cursorSql}
        ORDER BY n.created_at DESC, n.id DESC LIMIT $limit`).all(args);
      const { rows, nextCursor } = finishPage(found, limit);
      return {
        readContract: READ_CONTRACT,
        notifications: rows.map((n) => ({
          id: n.id, type: n.type, actorId: n.actor_id,
          actorName: n.actor_name || "Someone", actorInitials: n.actor_initials || "?",
          actorUri: safePublicProfileImage(n.actor_id, n.actor_uri), actorColor: n.actor_color,
          postId: n.post_id, commentId: n.comment_id || null, artist: n.artist, text: n.text,
          ts: n.created_at, read: !!n.read,
        })),
        unread: unread(account.id), inboxUnread: directMessageInboxUnread(database, account.id), nextCursor,
      };
    },

    // A distinct endpoint makes new clients fail closed against old servers
    // after rollback or when a load balancer mixes old and new instances.
    "POST /api/me/notifications/read/scoped": acknowledge,
    "POST /api/me/notifications/read": acknowledge,
  };
}
