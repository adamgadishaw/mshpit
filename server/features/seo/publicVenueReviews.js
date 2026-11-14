import { venueLookupKeys } from "../../../src/domain/venueIdentity.mjs";
import { MEDIA_POST_MAX_ATTACHMENTS } from "../../../src/domain/mediaUploadPolicy.mjs";
import { venueReviewVisibilitySql } from "./venueReviewVisibility.js";
import { safeOwnedReadyMediaUrl } from "../../publicMedia.js";

const DEFAULT_REVIEW_LIMIT = 8;
const MAX_REVIEW_LIMIT = 8;
const READ_BATCH_SIZE = 250;
const MAX_VENUE_KEY_LENGTH = 200;
const MAX_TEXT_LENGTH = 8_000;

function normalizedVenueKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key || key.length > MAX_VENUE_KEY_LENGTH || /[\u0000-\u001f\u007f]/u.test(key)) return null;
  return key;
}

function cleanLine(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function isSubstantiveText(value) {
  return [...String(value || "").replace(/\s+/gu, " ").trim()].length >= 40;
}

function validRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0.5 && rating <= 5 ? rating : null;
}

function parsedPhotoCandidates(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((candidate) => typeof candidate === "string")
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate && candidate.length <= 2_000)
      .slice(0, MEDIA_POST_MAX_ATTACHMENTS);
  } catch {
    return [];
  }
}

function boundedLimit(value) {
  if (value === 0) return 0;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0
    ? Math.min(MAX_REVIEW_LIMIT, numeric)
    : DEFAULT_REVIEW_LIMIT;
}

function publicPhotos(database, row, verificationCache) {
  if (!row.photos_public) return [];
  const photos = [];
  const seen = new Set();
  for (const candidate of parsedPhotoCandidates(row.photos)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const cacheKey = JSON.stringify([row.user_id, candidate]);
    let verified = verificationCache.get(cacheKey);
    if (verified === undefined) {
      verified = safeOwnedReadyMediaUrl(database, {
        ownerId: row.user_id,
        url: candidate,
        kind: "image",
      }) || null;
      verificationCache.set(cacheKey, verified);
    }
    if (verified) photos.push(verified);
    if (photos.length >= 3) break;
  }
  return photos;
}

function projectedReview(row, { text, photos, rating }) {
  return {
    id: cleanLine(row.id, 120),
    author: {
      name: cleanLine(row.name, 100) || "Mshpit member",
      handle: cleanLine(row.handle, 40).replace(/^@+/u, "") || null,
    },
    rating,
    text,
    photos,
    createdAt: Number.isSafeInteger(Number(row.created_at)) && Number(row.created_at) >= 0
      ? Number(row.created_at)
      : null,
  };
}

export function createPublicVenueReviewService(database, { resolveReviewKeys = null } = {}) {
  if (!database?.prepare) throw new TypeError("Public venue reviews require a database");

  const hasEditTime = database.prepare('PRAGMA table_info(venue_reviews)').all().some(column => column.name === 'updated_at');
  const orderAt = hasEditTime ? 'coalesce(r.updated_at,r.created_at)' : 'r.created_at';
  const rowsForVenue = database.prepare(`SELECT r.id,r.user_id,r.rating,r.text,r.photos,r.photos_public,r.created_at,${orderAt} AS rating_at,
      u.name,u.handle
    FROM venue_reviews r
    JOIN users u ON u.id=r.user_id
    WHERE r.venue_key IN (SELECT value FROM json_each(@keys)) AND ${venueReviewVisibilitySql()}
      AND (@cursorAt IS NULL OR ${orderAt}<@cursorAt OR (${orderAt}=@cursorAt AND r.id<@cursorId))
    ORDER BY ${orderAt} DESC,r.id DESC
    LIMIT @limit`);

  return Object.freeze({
    read({ venueKey, canonicalPath = null, viewerId = null, limit = DEFAULT_REVIEW_LIMIT } = {}) {
      const key = normalizedVenueKey(venueKey);
      if (!key) return null;
      // A canonical target never borrows name-only history without resolver proof.
      const keys = resolveReviewKeys ? resolveReviewKeys({ venueKey: key, canonicalPath })
        : canonicalPath ? [canonicalPath] : key.startsWith('/venue/') ? [key] : venueLookupKeys(key);
      const visibleLimit = boundedLimit(limit);
      const reviews = [];
      const latestEligibleUsers = new Set();
      const latestRatedUsers = new Set();
      const verificationCache = new Map();
      let ratingTotal = 0;
      let cursorAt = null;
      let cursorId = null;

      while (true) {
        const rows = rowsForVenue.all({ keys: JSON.stringify(keys), viewer: viewerId, cursorAt, cursorId, limit: READ_BATCH_SIZE });
        if (!rows.length) break;

        for (const row of rows) {
          const text = cleanText(row.text);
          const photos = publicPhotos(database, row, verificationCache);
          const excerptEligible = isSubstantiveText(text) || photos.length > 0;

          // Numeric ratings do not require prose or public media. Excerpt
          // publication alone retains its substantive-text/verified-photo rule.
          const rating = validRating(row.rating);
          if (excerptEligible && !latestEligibleUsers.has(row.user_id)) {
            latestEligibleUsers.add(row.user_id);
            if (reviews.length < visibleLimit) {
              reviews.push(projectedReview(row, { text, photos, rating }));
            }
          }
          // Invalid legacy values cannot erase an earlier valid score. The
          // first visible valid 0.5..5 row in newest-first order is authoritative.
          if (rating != null && !latestRatedUsers.has(row.user_id)) {
            latestRatedUsers.add(row.user_id);
            ratingTotal += rating;
          }
        }

        if (rows.length < READ_BATCH_SIZE) break;
        const last = rows.at(-1);
        cursorAt = Number(last.rating_at);
        cursorId = String(last.id);
      }

      const ratingCount = latestRatedUsers.size;
      return {
        reviews,
        stats: {
          reviewCount: latestEligibleUsers.size,
          ratingCount,
          averageRating: ratingCount
            ? Math.round((ratingTotal / ratingCount) * 100) / 100
            : null,
        },
      };
    },
  });
}
