import { activeAccountSql } from "./accountVisibility.js";
import { verifiedFinalizedLegacyMedia } from "./mediaLegacyFinalize.js";
import { postMediaStateByPost } from "./mediaAssets.js";
import { safeOwnedReadyMediaUrl } from "./publicMedia.js";
import { venueLookupKeys, venueLookupSlugs } from "../src/domain/venueIdentity.mjs";

export const VENUE_FAN_PHOTO_LIMIT = 12;
const VENUE_FAN_PHOTO_CANDIDATE_LIMIT = 96;

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function boundedLimit(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, VENUE_FAN_PHOTO_LIMIT)
    : VENUE_FAN_PHOTO_LIMIT;
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function readyImageUrl(database, ownerId, value) {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return null;
  return safeOwnedReadyMediaUrl(database, { ownerId, url, kind: "image" })
    || (verifiedFinalizedLegacyMedia(database, { ownerId, publicUrl: url }) ? url : null);
}

function blockClause(viewerId, authorSql) {
  return viewerId ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=${authorSql}) OR
    (b.blocker_id=${authorSql} AND b.blocked_id=?))` : "";
}

function visiblePostCandidates(database, {
  identitySql,
  identityArgs,
  indexName,
  viewer,
  limit,
}) {
  const args = [...identityArgs];
  if (viewer) args.push(viewer, viewer);
  args.push(limit);
  return database.prepare(`SELECT p.id,p.user_id,p.photos,p.created_at
    FROM posts p INDEXED BY ${indexName} JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND p.photos_public=1 AND COALESCE(p.kind,'review')='review'
      AND ${identitySql} AND ${activeAccountSql("u")}
      AND NOT EXISTS (SELECT 1 FROM reports report
        WHERE report.target_type='post' AND report.target_id=p.id AND report.status='open')
      ${blockClause(viewer, "p.user_id")}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all(...args);
}

export function publicVenueFanPhotos(database, {
  venueKey,
  viewerId = null,
  limit = VENUE_FAN_PHOTO_LIMIT,
} = {}) {
  if (!database?.prepare) return [];
  const keys = venueLookupKeys(venueKey);
  const slugs = venueLookupSlugs(venueKey);
  if (!keys.length) return [];
  const max = boundedLimit(limit);
  const viewer = typeof viewerId === "string" && viewerId ? viewerId : null;
  const candidateLimit = Math.min(VENUE_FAN_PHOTO_CANDIDATE_LIMIT, Math.max(24, max * 6));

  const reviewArgs = [...keys];
  if (viewer) reviewArgs.push(viewer, viewer);
  reviewArgs.push(candidateLimit);
  const reviews = database.prepare(`SELECT r.id,r.user_id,r.photos,r.created_at
    FROM venue_reviews r JOIN users u ON u.id=r.user_id
    WHERE r.venue_key IN (${placeholders(keys)}) AND r.removed=0 AND r.photos_public=1 AND ${activeAccountSql("u")}
      AND NOT EXISTS (SELECT 1 FROM reports report
        WHERE report.target_type='venue_review' AND report.target_id=r.id AND report.status='open')
      ${blockClause(viewer, "r.user_id")}
    ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).all(...reviewArgs);

  // Keep current rows on the canonical venue_key index. The separately bounded
  // legacy fallback is forced through the existing venue-slug expression index;
  // one OR query would let SQLite scan the entire posts table on every gallery.
  const currentPosts = visiblePostCandidates(database, {
    identitySql: `p.venue_key IS NOT NULL AND p.venue_key IN (${placeholders(keys)})`,
    identityArgs: keys,
    indexName: "idx_posts_venue_visibility",
    viewer,
    limit: candidateLimit,
  });
  const legacyPosts = slugs.length ? visiblePostCandidates(database, {
    identitySql: `p.venue_key IS NULL AND trim(COALESCE(p.venue,''))<>''
      AND pit_public_slug(p.venue) IN (${placeholders(slugs)})`,
    identityArgs: slugs,
    indexName: "idx_posts_venue_public_slug",
    viewer,
    limit: candidateLimit,
  }) : [];
  const posts = [...new Map([...currentPosts, ...legacyPosts].map((post) => [post.id, post])).values()]
    .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0)
      || String(right.id).localeCompare(String(left.id)))
    .slice(0, candidateLimit);

  const stableByPost = postMediaStateByPost(database, posts.map((post) => post.id)).assetsByPost;
  const records = [];
  for (const review of reviews) {
    for (const candidate of jsonArray(review.photos)) {
      const uri = readyImageUrl(database, review.user_id, candidate);
      if (uri) {
        records.push({
          uri,
          source: "fan",
          origin: "venue-review",
          ownerId: review.user_id,
          venueReviewId: review.id,
          createdAt: review.created_at,
        });
      }
    }
  }
  for (const post of posts) {
    const candidates = [
      ...(stableByPost.get(post.id) || [])
        .filter((asset) => asset.kind === "image")
        .map((asset) => asset.url),
      ...jsonArray(post.photos),
    ];
    for (const candidate of candidates) {
      const uri = readyImageUrl(database, post.user_id, candidate);
      if (uri) {
        records.push({
          uri,
          source: "fan",
          origin: "post",
          ownerId: post.user_id,
          postId: post.id,
          createdAt: post.created_at,
        });
      }
    }
  }

  records.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0)
    || (left.origin === "venue-review" ? -1 : 1));
  const out = [];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.uri)) continue;
    seen.add(record.uri);
    out.push(record);
    if (out.length >= max) break;
  }
  return out;
}
