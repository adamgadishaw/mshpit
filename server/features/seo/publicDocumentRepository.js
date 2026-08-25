import { activeAccountSql } from "../../accountVisibility.js";

const bounded = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const PUBLIC_POST_COLUMNS = `p.id,p.user_id,p.artist,p.artist_key,p.venue,p.city,p.date,p.overall,
  p.review,p.photos,p.photos_public,p.kind,p.created_at,p.updated_at,
  COALESCE(
    (SELECT canonical.public_slug FROM artists canonical WHERE canonical.norm=p.artist_key LIMIT 1),
    (SELECT legacy.public_slug FROM artists legacy
      WHERE p.artist_key IS NULL AND legacy.name=p.artist COLLATE NOCASE
      ORDER BY legacy.rank_score DESC,legacy.norm LIMIT 1)
  ) AS artist_public_slug,
  u.name AS u_name,u.handle AS u_handle,u.avatar_uri AS u_avatar,
  (SELECT COUNT(*) FROM likes l JOIN users liker ON liker.id=l.user_id
    WHERE l.post_id=p.id AND ${activeAccountSql("liker")}) AS like_count,
  (SELECT COUNT(*) FROM comments c JOIN users commenter ON commenter.id=c.user_id
    WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("commenter")}) AS comment_count`;

function artistPostIdentity(alias = "p") {
  return `(${alias}.artist_key=? OR (${alias}.artist_key IS NULL AND LOWER(${alias}.artist)=LOWER(?)))`;
}

/**
 * SQL-only reads for crawler-visible documents.
 *
 * This repository deliberately returns storage rows rather than API/user
 * projections. The projector is the only place that may turn those rows into
 * public values, which keeps private columns and legacy media URLs from being
 * accidentally spread into a renderer.
 */
export function createPublicDocumentRepository(database) {
  if (!database?.prepare) throw new TypeError("Public SEO documents require a database");

  const homeArtists = database.prepare(`SELECT a.norm,a.name,a.public_slug,a.genre,a.bio,a.country,a.formed,a.updated_at,
      (SELECT COUNT(*) FROM posts rp JOIN users reviewer ON reviewer.id=rp.user_id
        WHERE rp.removed=0 AND COALESCE(rp.kind,'review')='review'
          AND (rp.artist_key=a.norm OR (rp.artist_key IS NULL AND LOWER(rp.artist)=LOWER(a.name)))
          AND ${activeAccountSql("reviewer")}) AS review_count
    FROM artists a
    WHERE LENGTH(TRIM(a.name))>0 AND (
      LENGTH(TRIM(COALESCE(a.bio,'')))>=80 OR EXISTS (
        SELECT 1 FROM posts ep JOIN users eu ON eu.id=ep.user_id
        WHERE ep.removed=0 AND COALESCE(ep.kind,'review')='review'
          AND LENGTH(TRIM(COALESCE(ep.review,'')))>=40
          AND (ep.artist_key=a.norm OR (ep.artist_key IS NULL AND LOWER(ep.artist)=LOWER(a.name)))
          AND ${activeAccountSql("eu")}
      )
    )
    ORDER BY a.rank_score DESC,a.popularity DESC,a.name COLLATE NOCASE,a.norm
    LIMIT ?`);

  const homePosts = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${activeAccountSql("u")}
      AND LENGTH(TRIM(COALESCE(p.review,'')))>=40
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`);

  const artistByKey = database.prepare(`SELECT norm,name,public_slug,genre,bio,country,formed,updated_at
    FROM artists WHERE norm=? LIMIT 1`);
  const artistByName = database.prepare(`SELECT norm,name,public_slug,genre,bio,country,formed,updated_at
    FROM artists WHERE LOWER(name)=LOWER(?) ORDER BY rank_score DESC,norm LIMIT 1`);
  const artistProfile = database.prepare(`SELECT ap.bio,ap.banner,ap.avatar_uri,ap.feed_enabled,
      ap.owner_id,ap.updated_at
    FROM artist_profiles ap JOIN users owner ON owner.id=ap.owner_id
    WHERE ap.artist_key=? AND ap.removed=0 AND ${activeAccountSql("owner")} LIMIT 1`);
  const artistReviews = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (
        p.photos_public=1 AND EXISTS (SELECT 1 FROM post_media media WHERE media.post_id=p.id)
      ))
      AND ${artistPostIdentity("p")} AND ${activeAccountSql("u")}
    ORDER BY (like_count+comment_count) DESC,p.overall DESC,
      CASE WHEN p.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN p.date ELSE '' END DESC,
      p.created_at DESC,p.id ASC LIMIT ?`);
  const artistReviewStats = database.prepare(`SELECT COUNT(*) AS review_count,AVG(p.overall) AS average_rating,
      MAX(COALESCE(p.updated_at,p.created_at)) AS latest_at
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND LENGTH(TRIM(COALESCE(p.review,'')))>=40
      AND ${artistPostIdentity("p")} AND ${activeAccountSql("u")}`);
  const artistUpdates = database.prepare(`SELECT post.id,post.user_id,post.text,post.created_at,
      author.name AS u_name,author.handle AS u_handle
    FROM artist_posts post JOIN users author ON author.id=post.user_id
    WHERE post.artist_key=? AND post.removed=0 AND ${activeAccountSql("author")}
    ORDER BY post.created_at DESC,post.id DESC LIMIT ?`);
  const artistEvents = database.prepare(`SELECT td.id,td.artist,td.venue,td.place,td.date,td.sold_out
    FROM tour_dates td
    WHERE LOWER(td.artist)=LOWER(?) AND td.release_at<=? AND td.date>=?
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND (td.owner_id IS NULL OR EXISTS (
        SELECT 1 FROM users event_owner WHERE event_owner.id=td.owner_id
          AND ${activeAccountSql("event_owner")}
      ))
    ORDER BY td.date ASC,td.id ASC LIMIT ?`);

  const memberByHandle = database.prepare(`SELECT u.id,u.name,u.handle,u.artist_name,u.bio,
      u.avatar_uri,u.banner,u.created_at
    FROM users u WHERE u.handle=? AND ${activeAccountSql("u")} LIMIT 1`);
  const memberById = database.prepare(`SELECT u.id,u.name,u.handle,u.artist_name,u.bio,
      u.avatar_uri,u.banner,u.created_at
    FROM users u WHERE u.id=? AND ${activeAccountSql("u")} LIMIT 1`);
  const memberPosts = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.user_id=? AND p.removed=0 AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (
        p.photos_public=1 AND EXISTS (SELECT 1 FROM post_media media WHERE media.post_id=p.id)
      ))
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`);
  const memberStats = database.prepare(`SELECT
      (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.removed=0
        AND LENGTH(TRIM(COALESCE(p.review,'')))>=40) AS post_count,
      (SELECT COUNT(*) FROM follows f JOIN users follower ON follower.id=f.follower_id
        WHERE f.followee_id=u.id AND ${activeAccountSql("follower")}) AS follower_count
    FROM users u WHERE u.id=? AND ${activeAccountSql("u")}`);

  const postById = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.removed=0 AND ${activeAccountSql("u")} LIMIT 1`);
  const postComments = database.prepare(`SELECT c.id,c.text,c.created_at,
      author.id AS user_id,author.name AS u_name,author.handle AS u_handle,
      author.avatar_uri AS u_avatar
    FROM comments c JOIN users author ON author.id=c.user_id
    WHERE c.post_id=? AND c.removed=0 AND ${activeAccountSql("author")}
    ORDER BY c.created_at ASC,c.id ASC LIMIT ?`);

  function readArtistRecord({ artistKey = null, name = null } = {}) {
    const key = typeof artistKey === "string" ? artistKey.trim().toLowerCase() : "";
    const displayName = typeof name === "string" ? name.trim() : "";
    if (key) return artistByKey.get(key) || null;
    return displayName ? artistByName.get(displayName) || null : null;
  }

  return Object.freeze({
    readHome({ artistLimit = 6, postLimit = 6 } = {}) {
      const artists = homeArtists.all(bounded(artistLimit, 6, 12));
      return { artists, posts: homePosts.all(bounded(postLimit, 6, 12)) };
    },

    readArtist({ artistKey = null, name = null, reviewLimit = 3, updateLimit = 3, eventLimit = 3, at = Date.now(), today = null } = {}) {
      const artist = readArtistRecord({ artistKey, name });
      if (!artist) return null;
      const identityArgs = [artist.norm, artist.name];
      const profile = artistProfile.get(artist.norm) || null;
      const updates = profile?.feed_enabled
        ? artistUpdates.all(artist.norm, bounded(updateLimit, 3, 6))
        : [];
      const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
        ? today
        : new Date(Number.isFinite(Number(at)) ? Number(at) : Date.now()).toISOString().slice(0, 10);
      return {
        artist,
        profile,
        reviews: artistReviews.all(...identityArgs, bounded(reviewLimit, 3, 6)),
        stats: artistReviewStats.get(...identityArgs) || null,
        updates,
        events: artistEvents.all(artist.name, Number.isFinite(Number(at)) ? Number(at) : Date.now(), day, bounded(eventLimit, 3, 6)),
      };
    },

    readMember({ id = null, handle = null, postLimit = 8 } = {}) {
      const memberId = typeof id === "string" ? id.trim() : "";
      const memberHandle = typeof handle === "string" ? handle.replace(/^@+/, "").trim().toLowerCase() : "";
      const member = memberId
        ? memberById.get(memberId) || null
        : memberHandle ? memberByHandle.get(memberHandle) || null : null;
      if (!member) return null;
      return {
        member,
        stats: memberStats.get(member.id) || null,
        posts: memberPosts.all(member.id, bounded(postLimit, 8, 12)),
      };
    },

    readPost({ id, commentLimit = 20 } = {}) {
      const postId = typeof id === "string" ? id.trim() : "";
      if (!postId) return null;
      const post = postById.get(postId) || null;
      if (!post) return null;
      return {
        post,
        comments: postComments.all(post.id, bounded(commentLimit, 20, 50)),
      };
    },
  });
}
