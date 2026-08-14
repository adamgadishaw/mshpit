import { db, parseJsonArray } from "./db.js";

export const LANDING_MEDIA_DEFAULT_LIMIT = 8;
export const LANDING_MEDIA_MAX_LIMIT = 12;
const LANDING_MEDIA_MAX_CANDIDATES = 96;
const LANDING_MEDIA_MAX_PER_AUTHOR = 1;
// The homepage targets every browser. HEIC/HEIF is not portable enough here,
// and animated GIFs are intentionally excluded from a full-screen background.
const IMAGE_PATH = /\.(?:jpe?g|png|webp)$/i;

function boundedLimit(value) {
  const requested = Number(value);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, LANDING_MEDIA_MAX_LIMIT)
    : LANDING_MEDIA_DEFAULT_LIMIT;
}

function cleanPublicLabel(value, max = 120) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function normalizedBasePath(pathname) {
  const clean = String(pathname || "").replace(/\/+$/, "");
  return clean === "/" ? "" : clean;
}

// A homepage load reaches substantially more people than an ordinary feed card.
// Only serve objects issued by PIT's own public-media origin and bound to the
// author/post path; an arbitrary URL pasted into an old client must never become
// a tracking pixel on the marketing page.
export function trustedLandingImageUrl(value, { authorId, mediaBaseUrl } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";
  const safeAuthorId = String(authorId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!raw || raw.length > 2000 || !safeAuthorId || !mediaBaseUrl) return null;

  try {
    const candidate = new URL(raw);
    const base = new URL(mediaBaseUrl);
    if (candidate.protocol !== "https:" || base.protocol !== "https:") return null;
    if (candidate.origin !== base.origin || candidate.username || candidate.password) return null;
    const expectedPrefix = `${normalizedBasePath(base.pathname)}/users/${safeAuthorId}/post/`;
    if (!candidate.pathname.startsWith(expectedPrefix) || !IMAGE_PATH.test(candidate.pathname)) return null;
    return candidate.toString();
  } catch {
    return null;
  }
}

export function hasTrustedLandingImage(photos, { authorId, mediaBaseUrl } = {}) {
  return Array.isArray(photos)
    && photos.some((value) => !!trustedLandingImageUrl(value, { authorId, mediaBaseUrl }));
}

function creditFor(row) {
  const handle = cleanPublicLabel(row?.u_handle, 20).replace(/^@+/, "");
  if (handle) return `Shared by @${handle}`;
  const name = cleanPublicLabel(row?.u_name, 80);
  return name ? `Shared by ${name}` : "Shared by the PIT community";
}

// Pure projection kept separately from the query so privacy and URL rules can
// be tested without a server or media bucket. Input order is authoritative and
// deterministic (newest post first from the query below).
export function projectLandingMedia(rows, { limit, mediaBaseUrl } = {}) {
  const max = boundedLimit(limit);
  const media = [];
  const seenUris = new Set();
  const byAuthor = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const authorId = String(row?.user_id || "");
    if (!authorId || (byAuthor.get(authorId) || 0) >= LANDING_MEDIA_MAX_PER_AUTHOR) continue;
    const photos = parseJsonArray(row?.photos).slice(0, 8);
    for (let photoIndex = 0; photoIndex < photos.length; photoIndex += 1) {
      const uri = trustedLandingImageUrl(photos[photoIndex], { authorId, mediaBaseUrl });
      if (!uri || seenUris.has(uri)) continue;
      seenUris.add(uri);
      byAuthor.set(authorId, (byAuthor.get(authorId) || 0) + 1);
      media.push({
        id: `${row.id}:${photoIndex}`,
        uri,
        credit: creditFor(row),
        postId: String(row.id),
        artist: cleanPublicLabel(row.artist, 120) || null,
        venue: cleanPublicLabel(row.venue, 160) || null,
      });
      break; // one hero frame per post keeps one night from taking over the reel
    }
    if (media.length >= max) break;
  }
  return media;
}

export function landingCommunityMedia({ viewerId = null, limit, at = Date.now(), mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL } = {}) {
  const max = boundedLimit(limit);
  if (!mediaBaseUrl) return [];
  const viewer = viewerId ? String(viewerId) : null;
  const blockSql = viewer ? `AND NOT EXISTS (
    SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR
      (b.blocker_id=p.user_id AND b.blocked_id=?)
  )` : "";
  const candidateLimit = Math.min(LANDING_MEDIA_MAX_CANDIDATES, Math.max(32, max * 8));
  const args = [Number.isFinite(Number(at)) ? Number(at) : Date.now()];
  if (viewer) args.push(viewer, viewer);
  args.push(candidateLimit);
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT p.id,p.user_id,p.artist,p.venue,p.photos,p.created_at,
        u.name AS u_name,u.handle AS u_handle,
        ROW_NUMBER() OVER (
          PARTITION BY p.user_id ORDER BY p.created_at DESC,p.id DESC
        ) AS author_rank
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.removed=0 AND p.photos_public=1 AND p.landing_showcase=1
        AND p.kind='review' AND p.photos!='[]'
        AND u.email_verified_at>0
        AND u.is_banned=0 AND (u.suspended_until IS NULL OR u.suspended_until<=?)
        AND NOT EXISTS (SELECT 1 FROM reports r
          WHERE r.target_type='post' AND r.target_id=p.id AND r.status='open')
        ${blockSql}
    )
    SELECT id,user_id,artist,venue,photos,created_at,u_name,u_handle
    FROM ranked
    WHERE author_rank<=4
    ORDER BY created_at DESC,id DESC
    LIMIT ?`).all(...args);
  return projectLandingMedia(rows, { limit: max, mediaBaseUrl });
}

export function landingTotals({ at = Date.now() } = {}) {
  const timestamp = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  const row = db.prepare(`SELECT
    (SELECT COUNT(*) FROM artists) AS artists,
    (SELECT COUNT(*) FROM users WHERE is_banned=0
      AND (suspended_until IS NULL OR suspended_until<=?)) AS members`).get(timestamp);
  return {
    artists: Math.max(0, Number(row?.artists) || 0),
    members: Math.max(0, Number(row?.members) || 0),
  };
}
