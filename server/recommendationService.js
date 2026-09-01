import { randomUUID } from "node:crypto";
import { db, parseJsonArray } from "./db.js";
import { ApiError } from "./errors.js";
import { rankRecommendations, RECOMMENDATION_ALGORITHM, recommendationKey } from "./recommendationRanking.js";
import { activeAccountSql } from "./accountVisibility.js";
import { projectArtistGenre } from "../src/domain/genre.mjs";
import { ARTIST_GENRE_SQL_COLUMNS, projectArtistGenreColumns } from "./artistGenreProjection.js";

const CANDIDATE_LIMIT = Math.max(200, Math.min(1200, Number(process.env.RECOMMENDATION_CANDIDATE_LIMIT) || 600));
const CANDIDATE_SCAN_LIMIT = Math.min(2400, CANDIDATE_LIMIT * 4);
const CANDIDATE_AUTHOR_LIMIT = 12;
const SNAPSHOT_TTL_MS = Math.max(5 * 60_000, Math.min(60 * 60_000, Number(process.env.RECOMMENDATION_SNAPSHOT_TTL_MS) || 20 * 60_000));
const SNAPSHOT_LIMIT = 250;
const snapshots = new Map();
const activeSnapshotByViewer = new Map();

// The posts table keeps an implicit monotonic rowid. Reading only its maximum
// gives head refreshes a cheap content revision: quiet polls reuse the current
// immutable recommendation snapshot, while a newly-created post causes the
// next poll to rank a fresh head instead of remaining stale until reload.
function postContentRevision() {
  return Number(db.prepare("SELECT MAX(rowid) revision FROM posts").get()?.revision) || 0;
}

// Candidate ranking deliberately avoids p.* and the ordinal/gallery/playlist
// projection. Only the selected 20-50 rows take the richer POST_SELECT path.
export const RECOMMENDATION_CANDIDATE_SELECT = `
  SELECT p.id,p.user_id,p.artist,p.artist_key,p.city,p.created_at,p.kind,
    CASE WHEN json_valid(p.photos) THEN json_array_length(p.photos) ELSE 0 END AS media_count,
    length(p.review) AS review_length,
    (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id
      WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
    (SELECT COUNT(DISTINCT c.user_id) FROM comments c JOIN users cu ON cu.id=c.user_id
      WHERE c.post_id=p.id AND c.removed=0 AND c.user_id<>p.user_id AND ${activeAccountSql("cu")}) AS comment_count
  FROM posts p
  JOIN users u ON u.id=p.user_id
`;

// These stay centralized so query-plan regression tests and operational
// benchmarks exercise the exact signal reads used by production ranking.
export const RECOMMENDATION_SIGNAL_SQL = Object.freeze({
  fanClubs: "SELECT artist FROM fan_club_members INDEXED BY idx_fan_club_members_user_artist WHERE user_id=? LIMIT 200",
  likes: `SELECT p.artist FROM likes l INDEXED BY idx_likes_user_post JOIN posts p ON p.id=l.post_id
    WHERE l.user_id=? AND p.removed=0 AND length(p.artist)>0 ORDER BY p.created_at DESC LIMIT 250`,
  comments: `SELECT p.artist FROM comments c INDEXED BY idx_comments_user_recent JOIN posts p ON p.id=c.post_id
    WHERE c.user_id=? AND c.removed=0 AND p.removed=0 AND length(p.artist)>0 ORDER BY c.created_at DESC LIMIT 200`,
});

const POST_SELECT = `
  SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials,
    u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
    u.profile_updated_at AS u_profile_updated_at,
    u.role AS u_role,u.artist_name AS u_artist_name,
    (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id
      WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
    (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
      WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")}) AS comment_count,
    CASE WHEN COALESCE(p.kind,'review')='review' AND COALESCE(p.experience_type,'in_person')='in_person'
      THEN (SELECT COUNT(*) FROM posts seen WHERE seen.user_id=p.user_id AND LOWER(seen.artist)=LOWER(p.artist)
        AND seen.removed=0 AND COALESCE(seen.kind,'review')='review'
        AND COALESCE(seen.experience_type,'in_person')='in_person'
        AND (seen.created_at<p.created_at OR (seen.created_at=p.created_at AND seen.id<=p.id)))
      ELSE NULL END AS seen_ordinal,
    a.genre AS artist_genre
  FROM posts p
  JOIN users u ON u.id=p.user_id
  LEFT JOIN artists a ON a.norm=p.artist_key
`;

function safeJsonArray(value) {
  return parseJsonArray(value).filter((item) => typeof item === "string");
}

function addArtistWeight(weights, artist, amount) {
  const key = recommendationKey(artist);
  if (!key) return;
  weights.set(key, Math.min(20, (weights.get(key) || 0) + amount));
}

function recommendationSignals(viewer, at) {
  if (!viewer?.id) return { artistWeights: new Map(), followedUserIds: new Set(), genres: new Set(), city: "" };
  const artistWeights = new Map();
  for (const artist of safeJsonArray(viewer.favorite_artists)) addArtistWeight(artistWeights, artist, 5);
  for (const row of db.prepare(RECOMMENDATION_SIGNAL_SQL.fanClubs).all(viewer.id)) addArtistWeight(artistWeights, row.artist, 6);
  for (const row of db.prepare("SELECT artist FROM posts WHERE user_id=? AND removed=0 AND length(artist)>0 ORDER BY created_at DESC LIMIT 200").all(viewer.id)) addArtistWeight(artistWeights, row.artist, 3);
  for (const row of db.prepare(RECOMMENDATION_SIGNAL_SQL.likes).all(viewer.id)) addArtistWeight(artistWeights, row.artist, 3);
  for (const row of db.prepare(RECOMMENDATION_SIGNAL_SQL.comments).all(viewer.id)) addArtistWeight(artistWeights, row.artist, 2);
  for (const row of db.prepare("SELECT artist FROM plays WHERE user_id=? AND length(artist)>0 ORDER BY created_at DESC LIMIT 250").all(viewer.id)) addArtistWeight(artistWeights, row.artist, 1);
  // Only safe internal post identifiers are read from analytics. A meaningful
  // dwell (10s+) counts once; a skim does not train the feed, and a normal open
  // cannot be double-counted again as a short dwell.
  for (const row of db.prepare(`SELECT p.artist FROM (
      SELECT json_extract(e.props,'$.postId') post_id,MAX(e.created_at) engaged_at
      FROM events e
      WHERE e.user_id=? AND e.created_at>=? AND (
        e.name='content_open' OR
        (e.name='content_dwell' AND json_extract(e.props,'$.durationBucket') IN ('10_to_30s','30_to_90s','over_90s')) OR
        (e.name='video_progress' AND json_extract(e.props,'$.milestone') IN ('50','75','100')) OR
        (e.name='recommendation_feedback' AND json_extract(e.props,'$.action') IN ('open','follow','share'))
      ) GROUP BY post_id ORDER BY engaged_at DESC LIMIT 300
    ) signal JOIN posts p ON p.id=signal.post_id
    WHERE p.removed=0 AND length(p.artist)>0 ORDER BY signal.engaged_at DESC`).all(viewer.id, at - 90 * 24 * 60 * 60 * 1000)) {
    addArtistWeight(artistWeights, row.artist, 1);
  }
  return {
    viewerId: viewer.id,
    artistWeights,
    followedUserIds: new Set(db.prepare("SELECT followee_id FROM follows WHERE follower_id=?").all(viewer.id).map((row) => row.followee_id)),
    genres: new Set(safeJsonArray(viewer.genres).map(recommendationKey).filter(Boolean)),
    city: recommendationKey(viewer.home_city),
  };
}

// Negative feedback is read once per request through the covering
// (user_id,name,created_at) index. Do not put json_extract in a correlated
// candidate subquery: at the raw-event cap that turns 600 candidates into
// thousands of repeated JSON scans and can make one feed request take seconds.
function hiddenRecommendationPostIds(viewer, at) {
  if (!viewer?.id) return new Set();
  return new Set(db.prepare(`SELECT post_id FROM recommendation_preferences
    WHERE user_id=? ORDER BY created_at DESC LIMIT 500`).all(viewer.id)
    .map((row) => row.post_id)
    .filter(Boolean));
}

function candidateGenreMap(rows) {
  const keys = [...new Set(rows.map((row) => row.artist_key).filter(Boolean))];
  const genres = new Map();
  for (let offset = 0; offset < keys.length; offset += 200) {
    const batch = keys.slice(offset, offset + 200);
    const placeholders = batch.map(() => "?").join(",");
    const catalog = db.prepare(`SELECT a.norm,${ARTIST_GENRE_SQL_COLUMNS}
      FROM artists a WHERE a.norm IN (${placeholders})`).all(...batch);
    for (const artist of catalog) {
      genres.set(artist.norm, projectArtistGenreColumns(artist));
    }
  }
  return genres;
}

function candidateRows(viewer, at, hiddenIds = new Set()) {
  const blockSql = viewer?.id ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))` : "";
  const args = [at, at];
  if (viewer?.id) args.push(viewer.id, viewer.id);
  args.push(Math.min(2400, CANDIDATE_SCAN_LIMIT + Math.min(500, hiddenIds.size)));
  const rows = db.prepare(`${RECOMMENDATION_CANDIDATE_SELECT}
    WHERE p.removed=0 AND p.created_at<=? AND u.is_banned=0
      AND (u.suspended_until IS NULL OR u.suspended_until<=?)
      ${blockSql}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all(...args);
  const authorCounts = new Map();
  const candidates = rows.filter((row) => {
    if (hiddenIds.has(row.id)) return false;
    const count = authorCounts.get(row.user_id) || 0;
    if (count >= CANDIDATE_AUTHOR_LIMIT) return false;
    authorCounts.set(row.user_id, count + 1);
    return true;
  }).slice(0, CANDIDATE_LIMIT);
  const genres = candidateGenreMap(candidates);
  return candidates.map((row) => ({
    ...row,
    verified_artist_genre: genres.get(row.artist_key) ?? null,
  }));
}

export function projectedRecommendationGenre(columnGenre, artistData) {
  let data = {};
  try {
    const parsed = JSON.parse(artistData || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch { /* Invalid legacy metadata must not promote its typed genre. */ }
  return projectArtistGenre(data, columnGenre).genre;
}

function rankingCandidate(row) {
  return {
    id: row.id,
    userId: row.user_id,
    artist: row.artist,
    artistKey: row.artist_key,
    genre: row.verified_artist_genre,
    city: row.city,
    createdAt: row.created_at,
    likes: row.like_count,
    comments: row.comment_count,
    mediaCount: Number(row.media_count) || 0,
    reviewLength: Number(row.review_length) || 0,
    kind: row.kind || "review",
  };
}

function pruneSnapshots(at) {
  for (const [id, snapshot] of snapshots) {
    if (snapshot.expiresAt > at) continue;
    snapshots.delete(id);
    if (activeSnapshotByViewer.get(snapshot.viewerKey) === id) activeSnapshotByViewer.delete(snapshot.viewerKey);
  }
  while (snapshots.size >= SNAPSHOT_LIMIT) {
    const id = snapshots.keys().next().value;
    const snapshot = snapshots.get(id);
    snapshots.delete(id);
    if (snapshot && activeSnapshotByViewer.get(snapshot.viewerKey) === id) activeSnapshotByViewer.delete(snapshot.viewerKey);
  }
}

function createSnapshot(viewer, at, hiddenIds) {
  pruneSnapshots(at);
  const viewerKey = viewer?.id || "guest";
  const activeId = activeSnapshotByViewer.get(viewerKey);
  const active = activeId ? snapshots.get(activeId) : null;
  const contentRevision = postContentRevision();
  if (active && active.expiresAt > at && active.contentRevision === contentRevision) return active;
  // The requesting client will adopt the fresh snapshot's cursor. Retire its
  // former active snapshot so routine publishing cannot exhaust the bounded
  // in-memory pool with superseded heads.
  if (activeId) snapshots.delete(activeId);
  const ranked = rankRecommendations(candidateRows(viewer, at, hiddenIds).map(rankingCandidate), recommendationSignals(viewer, at), {
    snapshotAt: at,
    seed: `${viewerKey}:${Math.floor(at / SNAPSHOT_TTL_MS)}`,
  });
  const id = randomUUID();
  const snapshot = {
    id,
    viewerKey,
    at,
    expiresAt: at + SNAPSHOT_TTL_MS,
    contentRevision,
    ids: ranked.map((entry) => entry.candidate.id),
    recommendations: new Map(ranked.map((entry) => [entry.candidate.id, {
      algorithm: RECOMMENDATION_ALGORITHM,
      algorithmVersion: 1,
      candidateSource: "global",
      reasonCode: entry.reason.code,
      reason: entry.reason.label,
      feedContext: `discover:${entry.reason.code}`,
      personalized: !!viewer?.id && entry.personalScore !== 0,
    }])),
  };
  snapshots.set(id, snapshot);
  activeSnapshotByViewer.set(viewerKey, id);
  return snapshot;
}

function encodePageCursor(snapshotId, offset) {
  return Buffer.from(JSON.stringify({ v: 1, snapshotId, offset }), "utf8").toString("base64url");
}

function decodePageCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    if (parsed?.v !== 1 || typeof parsed.snapshotId !== "string" || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "That recommendation page expired. Refresh the feed to continue.", "RECOMMENDATION_CURSOR_INVALID");
  }
}

function liveRows(ids, viewer, at, hiddenIds = new Set()) {
  const visibleIds = ids.filter((id) => !hiddenIds.has(id));
  if (!visibleIds.length) return [];
  const placeholders = visibleIds.map(() => "?").join(",");
  const blockSql = viewer?.id ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))` : "";
  const args = [...visibleIds, at];
  if (viewer?.id) args.push(viewer.id, viewer.id);
  const found = db.prepare(`${POST_SELECT}
    WHERE p.id IN (${placeholders}) AND p.removed=0 AND u.is_banned=0
      AND (u.suspended_until IS NULL OR u.suspended_until<=?)
      ${blockSql}`).all(...args);
  const byId = new Map(found.map((row) => [row.id, row]));
  return visibleIds.map((id) => byId.get(id)).filter(Boolean);
}

export function recommendedFeedPage({ viewer = null, cursor = null, limit = 20, at = Date.now() } = {}) {
  const pageSize = Number.isSafeInteger(limit) ? Math.max(1, Math.min(50, limit)) : 20;
  const hiddenIds = hiddenRecommendationPostIds(viewer, at);
  let snapshot;
  let offset = 0;
  if (cursor) {
    const decoded = decodePageCursor(cursor);
    snapshot = snapshots.get(decoded.snapshotId);
    if (!snapshot || snapshot.expiresAt <= at || snapshot.viewerKey !== (viewer?.id || "guest")) {
      if (snapshot?.expiresAt <= at) snapshots.delete(decoded.snapshotId);
      throw new ApiError(400, "That recommendation page expired. Refresh the feed to continue.", "RECOMMENDATION_CURSOR_EXPIRED");
    }
    offset = decoded.offset;
  } else {
    snapshot = createSnapshot(viewer, at, hiddenIds);
  }

  const rows = [];
  let consumed = offset;
  while (rows.length < pageSize && consumed < snapshot.ids.length) {
    const chunkIds = snapshot.ids.slice(consumed, Math.min(snapshot.ids.length, consumed + Math.max(pageSize * 2, 20)));
    const available = liveRows(chunkIds, viewer, at, hiddenIds);
    const byId = new Map(available.map((row) => [row.id, row]));
    for (const id of chunkIds) {
      consumed++;
      const row = byId.get(id);
      if (row) rows.push(row);
      if (rows.length >= pageSize) break;
    }
  }

  return {
    rows,
    recommendations: new Map(rows.map((row) => [row.id, snapshot.recommendations.get(row.id)])),
    nextCursor: consumed < snapshot.ids.length ? encodePageCursor(snapshot.id, consumed) : null,
    algorithm: {
      id: RECOMMENDATION_ALGORITHM,
      version: 1,
      candidateSource: "global",
      personalized: !!viewer?.id,
      snapshotAt: snapshot.at,
    },
  };
}

export function clearRecommendationSnapshotsForTests() {
  snapshots.clear();
  activeSnapshotByViewer.clear();
}
