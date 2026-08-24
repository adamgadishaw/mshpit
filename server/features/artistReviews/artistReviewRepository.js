import { activeAccountSql } from "../../accountVisibility.js";

const BLOCK_FILTER = `AND (? IS NULL OR NOT EXISTS (
  SELECT 1 FROM blocks b
  WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
     OR (b.blocker_id=p.user_id AND b.blocked_id=?)
))`;

function reviewQuery(identitySql) {
  return `WITH candidates AS (
    SELECT p.*,
      u.name AS u_name,
      u.handle AS u_handle,
      u.initials AS u_initials,
      u.avatar_uri AS u_avatar,
      u.avatar_color AS u_color,
      u.role AS u_role,
      u.artist_name AS u_artist_name,
      (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id
        WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
      (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
        WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")}) AS comment_count
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0
      AND COALESCE(p.kind,'review')='review'
      AND length(trim(p.review))>0
      AND ${identitySql}
      AND ${activeAccountSql("u")}
      ${BLOCK_FILTER}
  )
  SELECT * FROM candidates
  ORDER BY (like_count+comment_count) DESC,
    overall DESC,
    CASE WHEN date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN date ELSE '' END DESC,
    created_at DESC,
    id ASC
  LIMIT ?`;
}

export function createArtistReviewRepository(database) {
  if (!database?.prepare) throw new TypeError("Artist reviews require a database");
  // Canonical bindings remain authoritative. Historical reviews created before
  // artist_key existed can join the page by their matching display name, but a
  // row already bound to another key must never cross into this artist.
  const byArtistKey = database.prepare(reviewQuery(
    "(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))",
  ));
  const byArtistName = database.prepare(reviewQuery("LOWER(p.artist)=LOWER(?)"));

  return Object.freeze({
    findTopReviews({ artistKey = null, name = null, viewerId = null, limit = 3 } = {}) {
      const identity = artistKey || name;
      if (!identity) return [];
      const statement = artistKey ? byArtistKey : byArtistName;
      const scopedViewer = viewerId ? String(viewerId) : null;
      const identityArgs = artistKey ? [artistKey, name || null] : [name];
      return statement.all(...identityArgs, scopedViewer, scopedViewer, scopedViewer, limit);
    },
  });
}
