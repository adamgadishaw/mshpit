import { activeAccountSql } from "../../accountVisibility.js";
import { visibleTourDateRowsFrom } from "../../tourDateVisibility.js";
import { archiveIdentityPart, normalizeArchivePart } from "./artistArchiveKeys.js";
import { inPersonReviewSql } from "../../onlineReviews.js";

const VIEWER = "(SELECT viewer_id FROM archive_scope)";
const visibleActor = (actorSql) => `(${VIEWER} IS NULL OR NOT EXISTS (
  SELECT 1 FROM blocks actor_block
  WHERE (actor_block.blocker_id=${VIEWER} AND actor_block.blocked_id=${actorSql})
     OR (actor_block.blocker_id=${actorSql} AND actor_block.blocked_id=${VIEWER})
))`;

function reviewQuery(identitySql, { filterSql = "", cursor = false } = {}) {
  const cursorSql = cursor ? `AND (? IS NULL OR p.date<?
      OR (p.date=? AND p.created_at<?)
      OR (p.date=? AND p.created_at=? AND p.id<?))` : "";
  return `WITH archive_scope(viewer_id) AS (VALUES (?))
    SELECT p.*,
      u.name AS u_name,u.handle AS u_handle,u.initials AS u_initials,
      u.avatar_uri AS u_avatar,u.avatar_color AS u_color,
      (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id
        WHERE l.post_id=p.id AND ${activeAccountSql("lu")} AND ${visibleActor("l.user_id")}) AS like_count,
      (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
        WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")} AND ${visibleActor("c.user_id")}) AS comment_count
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${inPersonReviewSql("p")}
      AND p.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND ${identitySql} AND ${activeAccountSql("u")} AND ${visibleActor("p.user_id")}
      ${filterSql} ${cursorSql}
    ORDER BY p.date DESC,p.created_at DESC,p.id DESC LIMIT ?`;
}

function reviewCountQuery(identitySql, filterSql) {
  return `WITH archive_scope(viewer_id) AS (VALUES (?))
    SELECT COUNT(*) count FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${inPersonReviewSql("p")}
      AND p.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND ${identitySql} AND ${activeAccountSql("u")} AND ${visibleActor("p.user_id")}
      ${filterSql}`;
}

export function createArtistArchiveRepository(database) {
  if (!database?.prepare) throw new TypeError("Artist archive requires a database");
  // Use the exact same normalization at aggregation and SQL selection time.
  // SQLite's LOWER/TRIM cannot collapse punctuation or handle all Unicode case
  // variants, which could otherwise make a tour card omit matching reviews.
  database.function("pit_archive_normalize", { deterministic: true }, normalizeArchivePart);
  database.function("pit_archive_identity", { deterministic: true }, archiveIdentityPart);
  const byArtistKey = database.prepare(reviewQuery(
    "(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))",
  ));
  const byArtistName = database.prepare(reviewQuery("LOWER(p.artist)=LOWER(?)"));
  const pageQueries = {
    key: {
      show: database.prepare(reviewQuery(
        "(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))",
        { filterSql: "AND p.date=? AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?", cursor: true },
      )),
      tour: database.prepare(reviewQuery(
        "(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))",
        { filterSql: "AND pit_archive_normalize(p.tour)=?", cursor: true },
      )),
      year: database.prepare(reviewQuery(
        "(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))",
        { filterSql: "AND COALESCE(TRIM(p.tour),'')='' AND SUBSTR(p.date,1,4)=?", cursor: true },
      )),
    },
    name: {
      show: database.prepare(reviewQuery("LOWER(p.artist)=LOWER(?)", { filterSql: "AND p.date=? AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?", cursor: true })),
      tour: database.prepare(reviewQuery("LOWER(p.artist)=LOWER(?)", { filterSql: "AND pit_archive_normalize(p.tour)=?", cursor: true })),
      year: database.prepare(reviewQuery("LOWER(p.artist)=LOWER(?)", { filterSql: "AND COALESCE(TRIM(p.tour),'')='' AND SUBSTR(p.date,1,4)=?", cursor: true })),
    },
  };
  const countQueries = {
    key: {
      show: database.prepare(reviewCountQuery("(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))", "AND p.date=? AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?")),
      tour: database.prepare(reviewCountQuery("(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))", "AND pit_archive_normalize(p.tour)=?")),
      year: database.prepare(reviewCountQuery("(p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)))", "AND COALESCE(TRIM(p.tour),'')='' AND SUBSTR(p.date,1,4)=?")),
    },
    name: {
      show: database.prepare(reviewCountQuery("LOWER(p.artist)=LOWER(?)", "AND p.date=? AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?")),
      tour: database.prepare(reviewCountQuery("LOWER(p.artist)=LOWER(?)", "AND pit_archive_normalize(p.tour)=?")),
      year: database.prepare(reviewCountQuery("LOWER(p.artist)=LOWER(?)", "AND COALESCE(TRIM(p.tour),'')='' AND SUBSTR(p.date,1,4)=?")),
    },
  };
  function scopedSelection({ artistKey, name, show, tour }) {
    const identityArgs = artistKey ? [artistKey, name || null] : [name];
    if (show) return { identityArgs, kind: "show", filterArgs: [show.date, show.venueIdentity] };
    if (String(tour?.tourIdentity || "").startsWith("year:")) {
      return { identityArgs, kind: "year", filterArgs: [String(tour.tourIdentity).slice(5)] };
    }
    const normalizedTourIdentity = String(tour?.tourIdentity || "").startsWith("tour:")
      ? normalizeArchivePart(String(tour.tourIdentity).slice(5))
      : "";
    return { identityArgs, kind: "tour", filterArgs: [normalizedTourIdentity] };
  }

  return Object.freeze({
    findReviewRows({ artistKey = null, name = null, viewerId = null, limit = 2_000 } = {}) {
      const identity = artistKey || name;
      if (!identity) return [];
      const scopedViewer = viewerId ? String(viewerId) : null;
      const args = artistKey ? [artistKey, name || null] : [name];
      const take = Math.max(1, Math.min(2_000, Math.trunc(Number(limit) || 2_000)));
      return (artistKey ? byArtistKey : byArtistName).all(scopedViewer, ...args, take);
    },

    findScopedReviewRows({ artistKey = null, name = null, viewerId = null, show = null, tour = null, cursor = null, limit = 20 } = {}) {
      if (!(artistKey || name) || (!!show === !!tour)) return [];
      const { identityArgs, kind, filterArgs } = scopedSelection({ artistKey, name, show, tour });
      const cursorArgs = cursor
        ? [cursor.date, cursor.date, cursor.date, cursor.createdAt, cursor.date, cursor.createdAt, cursor.id]
        : [null, null, null, null, null, null, null];
      const take = Math.max(1, Math.min(51, Math.trunc(Number(limit) || 20)));
      return pageQueries[artistKey ? "key" : "name"][kind]
        .all(viewerId || null, ...identityArgs, ...filterArgs, ...cursorArgs, take);
    },

    countScopedReviewRows({ artistKey = null, name = null, viewerId = null, show = null, tour = null } = {}) {
      if (!(artistKey || name) || (!!show === !!tour)) return 0;
      const { identityArgs, kind, filterArgs } = scopedSelection({ artistKey, name, show, tour });
      return Number(countQueries[artistKey ? "key" : "name"][kind]
        .get(viewerId || null, ...identityArgs, ...filterArgs)?.count) || 0;
    },

    findUpcomingRows({ name, viewer = null, today, limit = 500 } = {}) {
      if (!name || !today) return [];
      return visibleTourDateRowsFrom(database, viewer, {
        artist: name,
        today,
        limit: Math.max(1, Math.min(500, Number(limit) || 500)),
      });
    },

    findReactionCounts(mediaItems, viewerId = null) {
      const postIds = [...new Set((mediaItems || []).map((item) => item?.postId).filter(Boolean))];
      const counts = new Map();
      for (let start = 0; start < postIds.length; start += 100) {
        const chunk = postIds.slice(start, start + 100);
        const placeholders = chunk.map(() => "?").join(",");
        const blockSql = viewerId ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=mr.user_id) OR (b.blocker_id=mr.user_id AND b.blocked_id=?))` : "";
        const args = [...chunk];
        if (viewerId) args.push(viewerId, viewerId);
        const rows = database.prepare(`SELECT mr.post_id,mr.media_url,COUNT(*) reaction_count
          FROM media_reactions mr JOIN users ru ON ru.id=mr.user_id
          WHERE mr.post_id IN (${placeholders}) AND ${activeAccountSql("ru")} ${blockSql}
          GROUP BY mr.post_id,mr.media_url`).all(...args);
        for (const row of rows) counts.set(`${row.post_id}\0${row.media_url}`, Number(row.reaction_count) || 0);
      }
      return counts;
    },
  });
}
