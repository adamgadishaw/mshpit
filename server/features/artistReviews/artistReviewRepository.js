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
      AND (COALESCE(p.kind,'review')='review' OR (
        p.kind='status' AND p.artist_key IS NOT NULL AND p.artist_mbid IS NOT NULL AND p.overall=0
        AND EXISTS (SELECT 1 FROM artist_memorials memory_memorial
          WHERE memory_memorial.artist_key=p.artist_key
            AND lower(memory_memorial.artist_mbid)=lower(p.artist_mbid)
            AND memory_memorial.status='published')
      ))
      AND (length(trim(p.review))>0 OR (p.photos_public=1
        AND EXISTS (SELECT 1 FROM post_media memory_media WHERE memory_media.post_id=p.id)))
      AND ${identitySql}
      AND ${activeAccountSql("u")}
      ${BLOCK_FILTER}
  )
  SELECT * FROM candidates
  ORDER BY (like_count+comment_count) DESC,
    CASE WHEN ?=1 THEN 0 ELSE overall END DESC,
    CASE WHEN ?=1 THEN created_at ELSE 0 END DESC,
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
  const publishedMemorial = database.prepare(`SELECT 1 present FROM artist_memorials
    WHERE artist_key=? AND status='published' LIMIT 1`);

  return Object.freeze({
    findTopReviews({ artistKey = null, name = null, viewerId = null, limit = 3 } = {}) {
      const identity = artistKey || name;
      if (!identity) return [];
      const statement = artistKey ? byArtistKey : byArtistName;
      const scopedViewer = viewerId ? String(viewerId) : null;
      const identityArgs = artistKey ? [artistKey, name || null] : [name];
      const memorialMode = !!artistKey && !!publishedMemorial.get(artistKey);
      return statement.all(...identityArgs, scopedViewer, scopedViewer, scopedViewer, memorialMode ? 1 : 0, memorialMode ? 1 : 0, limit);
    },
  });
}
