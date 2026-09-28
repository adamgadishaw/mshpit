import { accountIsPublic, activeAccountSql } from "../../accountVisibility.js";

// One row per member/target survives an unlike/unrepost. Keeping notified_at
// prevents toggle/retry spam, without storing another copy of authored content.
export function ensureSocialReactionSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, notified_at INTEGER,
    PRIMARY KEY(comment_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON comment_likes(user_id,comment_id);
  CREATE TABLE IF NOT EXISTS post_reposts (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, notified_at INTEGER,
    PRIMARY KEY(post_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_post_reposts_user_recent ON post_reposts(user_id,active,created_at DESC,post_id);
  CREATE INDEX IF NOT EXISTS idx_post_reposts_post_active ON post_reposts(post_id,active,user_id);`);
  const notificationColumns = db.prepare("PRAGMA table_info(notifications)").all();
  if (notificationColumns.length && !notificationColumns.some((column) => column.name === "comment_id")) {
    db.exec("ALTER TABLE notifications ADD COLUMN comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL");
  }
}

const blocked = (db, a, b) => !!a && !!b && !!db.prepare(`SELECT 1 FROM blocks
  WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`).get(a,b,b,a);

export function visibleReactionPost(db, postId, viewerId, at = Date.now()) {
  const post = db.prepare("SELECT * FROM posts WHERE id=? AND removed=0").get(postId);
  if (!post) return null;
  const author = db.prepare("SELECT * FROM users WHERE id=?").get(post.user_id);
  if (!accountIsPublic(author, at) || blocked(db, viewerId, post.user_id)) return null;
  return post;
}

// Deleted ancestors remain content-free thread tombstones. A reply may still
// receive a like, but a hidden/blocked/missing/cyclic ancestry never authorizes
// an interaction through an identifier guessed outside the visible thread.
export function visibleReactionComment(db, postId, commentId, viewerId, at = Date.now()) {
  const post = visibleReactionPost(db, postId, viewerId, at);
  if (!post) return null;
  let id = commentId;
  let target = null;
  const seen = new Set();
  for (let depth = 0; id && depth < 64; depth++) {
    if (seen.has(id)) return null;
    seen.add(id);
    const row = db.prepare("SELECT * FROM comments WHERE id=? AND post_id=?").get(id,postId);
    if (!row || (!target && row.removed)) return null;
    const author = db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id);
    if (!accountIsPublic(author,at) || blocked(db,viewerId,row.user_id)) return null;
    target ||= row;
    id = row.parent_id;
  }
  return id ? null : { post, comment: target };
}

export function commentLikeInfo(db, commentId, viewerId = null) {
  const rows = db.prepare(`SELECT COUNT(*) AS count,
    COALESCE(MAX(CASE WHEN l.user_id=? THEN 1 ELSE 0 END),0) AS liked
    FROM comment_likes l JOIN users actor ON actor.id=l.user_id
    WHERE l.comment_id=? AND l.active=1 AND ${activeAccountSql("actor")}
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=l.user_id) OR (b.blocker_id=l.user_id AND b.blocked_id=?))`)
    .get(viewerId,commentId,viewerId,viewerId);
  return { likes: Number(rows.count), liked: !!rows.liked };
}

// Developer-authored aliases only. The same visibility expression is used for
// attribution, counts and Following delivery, so a hidden reposter cannot be a
// secret distribution path. Original post authority is checked independently.
export const REPOST_VISIBLE_SQL = `${activeAccountSql("actor")}
  AND (COALESCE(actor.profile_audience,'everyone')<>'only_me' OR actor.id=$viewer)
  AND (COALESCE(actor.profile_audience,'everyone')<>'members' OR $viewer IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=$viewer AND b.blocked_id=r.user_id) OR (b.blocker_id=r.user_id AND b.blocked_id=$viewer)
    OR (b.blocker_id=p.user_id AND b.blocked_id=r.user_id) OR (b.blocker_id=r.user_id AND b.blocked_id=p.user_id))
  AND NOT EXISTS (SELECT 1 FROM account_mutes m WHERE m.muter_id=$viewer AND m.muted_id=r.user_id)`;

const emptyRepostInfo = () => ({ reposts: 0, reposted: false, repostedBy: [] });
const ORIGINAL_VISIBLE_SQL = `p.removed=0 AND ${activeAccountSql("author")}
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=$viewer))`;

export function repostInfoPage(db, postIds, viewerId = null) {
  const ids = [...new Set(postIds.filter(Boolean))];
  const result = new Map(ids.map(id => [id,emptyRepostInfo()]));
  // At most two indexed statements per 100 cards, not several queries per card.
  for (let offset=0; offset<ids.length; offset+=100) {
    const batch=ids.slice(offset,offset+100);
    const params = { $viewer: viewerId };
    const placeholders=batch.map((id,i)=>{ params[`$p${i}`]=id; return `$p${i}`; }).join(",");
    const from = `FROM post_reposts r JOIN users actor ON actor.id=r.user_id
      JOIN posts p ON p.id=r.post_id JOIN users author ON author.id=p.user_id
      WHERE r.post_id IN (${placeholders}) AND r.active=1 AND ${ORIGINAL_VISIBLE_SQL} AND ${REPOST_VISIBLE_SQL}`;
    const counts=db.prepare(`SELECT r.post_id,COUNT(*) count,MAX(CASE WHEN r.user_id=$viewer THEN 1 ELSE 0 END) mine ${from} GROUP BY r.post_id`).all(params);
    for (const row of counts) result.set(row.post_id,{reposts:Number(row.count),reposted:!!row.mine,repostedBy:[]});
    const people=db.prepare(`SELECT * FROM (SELECT r.post_id,actor.id,actor.name,actor.handle,r.created_at,
      ROW_NUMBER() OVER(PARTITION BY r.post_id ORDER BY r.created_at DESC,r.user_id) AS rank ${from}
      AND (r.user_id=$viewer OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$viewer AND f.followee_id=r.user_id))) WHERE rank<=3`).all(params);
    for (const row of people) result.get(row.post_id).repostedBy.push({userId:row.id,name:row.name,handle:row.handle,createdAt:row.created_at});
  }
  return result;
}

export function repostInfo(db, postId, viewerId = null) {
  return repostInfoPage(db,[postId],viewerId).get(postId) || emptyRepostInfo();
}

// n is the notification alias. Use exactly the same predicate for unread totals
// and page rows. A different actor's repost must not keep a withdrawn one alive.
export const SOCIAL_NOTIFICATION_VISIBLE_SQL = `(n.type NOT IN ('repost','comment_like') OR
  (n.type='repost' AND EXISTS (SELECT 1 FROM post_reposts r
    JOIN users actor ON actor.id=r.user_id JOIN posts p ON p.id=r.post_id JOIN users author ON author.id=p.user_id
    WHERE r.post_id=n.post_id AND r.user_id=n.actor_id AND r.active=1 AND ${ORIGINAL_VISIBLE_SQL} AND ${REPOST_VISIBLE_SQL})) OR
  (n.type='comment_like' AND EXISTS (SELECT 1 FROM comment_likes l
    JOIN users actor ON actor.id=l.user_id JOIN comments c ON c.id=l.comment_id
    JOIN posts p ON p.id=c.post_id JOIN users author ON author.id=p.user_id
    WHERE l.comment_id=n.comment_id AND l.user_id=n.actor_id AND l.active=1 AND c.post_id=n.post_id
      AND c.removed=0 AND ${activeAccountSql("actor")} AND ${ORIGINAL_VISIBLE_SQL}
      AND NOT EXISTS (WITH RECURSIVE ancestry(id,user_id,parent_id,depth) AS (
        SELECT id,user_id,parent_id,0 FROM comments WHERE id=c.id
        UNION ALL SELECT parent.id,parent.user_id,parent.parent_id,a.depth+1 FROM comments parent JOIN ancestry a
          ON parent.id=a.parent_id AND parent.post_id=c.post_id WHERE a.depth<63
      ) SELECT 1 FROM ancestry a LEFT JOIN users ancestor ON ancestor.id=a.user_id
        WHERE ancestor.id IS NULL OR NOT (${activeAccountSql("ancestor")})
          OR EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$viewer AND b.blocked_id=a.user_id) OR (b.blocker_id=a.user_id AND b.blocked_id=$viewer))
          OR (a.parent_id IS NOT NULL AND (a.depth=63 OR NOT EXISTS (SELECT 1 FROM comments parent WHERE parent.id=a.parent_id AND parent.post_id=c.post_id)))))))`;

export function followingPostIds(db, { viewerId, cursor = null, limit = 30 }) {
  const bounded = Math.max(1,Math.min(100,Math.floor(Number(limit) || 30)));
  // The id is always the ORIGINAL post, never an extra synthetic feed card.
  // First creation time is immutable across un/repost to prevent bump-spam.
  // News belongs in News and consented For You placement, never in Following.
  // A friend's repost (or following the news publisher) cannot override that.
  const eligibleOriginal=`${ORIGINAL_VISIBLE_SQL} AND p.id NOT GLOB 'news_*'
    AND NOT EXISTS (SELECT 1 FROM account_mutes m WHERE m.muter_id=$viewer AND m.muted_id=p.user_id)
    AND NOT EXISTS (SELECT 1 FROM recommendation_preferences pref WHERE pref.user_id=$viewer AND pref.post_id=p.id)`;
  return db.prepare(`WITH network AS MATERIALIZED (
    SELECT followee_id AS id FROM follows WHERE follower_id=$viewer UNION SELECT $viewer
  ), visible_reposts AS NOT MATERIALIZED (
    SELECT r.post_id,r.created_at FROM network edge JOIN post_reposts r ON r.user_id=edge.id
      JOIN posts p ON p.id=r.post_id JOIN users actor ON actor.id=r.user_id
      WHERE r.active=1 AND ${REPOST_VISIBLE_SQL}
  ), direct AS (
    SELECT p.id,p.created_at AS activity_at FROM network edge JOIN posts p ON p.user_id=edge.id JOIN users author ON author.id=p.user_id
      WHERE ${eligibleOriginal}
      AND ($before IS NULL OR p.created_at<$before OR (p.created_at=$before AND p.id<$id))
      AND NOT EXISTS (SELECT 1 FROM visible_reposts newer WHERE newer.post_id=p.id AND newer.created_at>p.created_at)
      ORDER BY p.created_at DESC,p.id DESC LIMIT $limit
  ), shared AS (
    SELECT p.id,MAX(r.created_at) AS activity_at FROM network edge
      CROSS JOIN post_reposts r INDEXED BY idx_post_reposts_user_recent
      CROSS JOIN posts p CROSS JOIN users actor CROSS JOIN users author
      WHERE r.user_id=edge.id AND r.active=1 AND p.id=r.post_id AND actor.id=r.user_id AND author.id=p.user_id
      AND ${REPOST_VISIBLE_SQL} AND ${eligibleOriginal}
      AND ($before IS NULL OR r.created_at<$before OR (r.created_at=$before AND p.id<$id))
      AND NOT EXISTS (SELECT 1 FROM visible_reposts newer WHERE newer.post_id=p.id AND newer.created_at>r.created_at)
      AND NOT (p.created_at>r.created_at AND EXISTS(SELECT 1 FROM network edge WHERE edge.id=p.user_id))
      GROUP BY p.id ORDER BY activity_at DESC,p.id DESC LIMIT $limit
  ), activity AS (SELECT * FROM direct UNION ALL SELECT * FROM shared)
  SELECT id,MAX(activity_at) AS activity_at FROM activity GROUP BY id
    ORDER BY activity_at DESC,id DESC LIMIT $limit`).all({
      $viewer: viewerId, $before: cursor?.createdAt ?? null, $id: cursor?.id || "", $limit: bounded + 1,
    });
}

export function socialReactionRoutes({ database: db, ApiError, requireUser, rateLimit, atomicWrite, addNotif, now = Date.now }) {
  const unavailable = () => { throw new ApiError(404,"That interaction is no longer available.","NOT_FOUND"); };
  const writer = (ctx) => {
    const user = requireUser(ctx);
    const fresh = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    if (!accountIsPublic(fresh,now())) throw new ApiError(403,"This interaction isn't available.","FORBIDDEN");
    if (!fresh.email_verified_at) throw new ApiError(403,"Confirm your email before interacting.","EMAIL_VERIFICATION_REQUIRED");
    return fresh;
  };
  const desired = (ctx, key) => {
    if (typeof ctx.body?.[key] !== "boolean") throw new ApiError(400,"Choose the intended reaction state.","VALIDATION_FAILED");
    return ctx.body[key];
  };
  const mutate = (table, targetKey, targetId, user, active, notify) => {
    const previous = db.prepare(`SELECT * FROM ${table} WHERE ${targetKey}=? AND user_id=?`).get(targetId,user.id);
    if (!active && !previous) return;
    const at = now();
    db.prepare(`INSERT INTO ${table} (${targetKey},user_id,active,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(${targetKey},user_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at
      WHERE ${table}.active<>excluded.active`).run(targetId,user.id,active ? 1 : 0,at,at);
    if (active && previous?.notified_at == null) {
      notify();
      db.prepare(`UPDATE ${table} SET notified_at=? WHERE ${targetKey}=? AND user_id=?`).run(at,targetId,user.id);
    }
  };
  return {
    "POST /api/posts/:postId/comments/:id/like": (ctx) => {
      writer(ctx); rateLimit(ctx,"comment-like",180,60*60_000);
      ctx.setHeader?.("Cache-Control","private, no-store");
      const liked = desired(ctx,"liked");
      return atomicWrite(() => {
        const user = writer(ctx);
        const target = visibleReactionComment(db,ctx.params.postId,ctx.params.id,user.id,now());
        if (!target) unavailable();
        mutate("comment_likes","comment_id",target.comment.id,user,liked,() => addNotif(target.comment.user_id,user.id,"comment_like",{
          postId: target.post.id, commentId: target.comment.id, artist: target.post.artist, text: null,
        }));
        return { ok: true, id: target.comment.id, postId: target.post.id, ...commentLikeInfo(db,target.comment.id,user.id) };
      });
    },
    "POST /api/posts/:id/repost": (ctx) => {
      writer(ctx); rateLimit(ctx,"post-repost",60,60*60_000);
      ctx.setHeader?.("Cache-Control","private, no-store");
      const reposted = desired(ctx,"reposted");
      return atomicWrite(() => {
        const user = writer(ctx);
        const post = visibleReactionPost(db,ctx.params.id,user.id,now());
        if (!post) unavailable();
        mutate("post_reposts","post_id",post.id,user,reposted,() => addNotif(post.user_id,user.id,"repost",{ postId: post.id, artist: post.artist }));
        return { ok: true, id: post.id, ...repostInfo(db,post.id,user.id) };
      });
    },
  };
}
