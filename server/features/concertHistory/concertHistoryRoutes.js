import { toIsoDate } from "../../../src/domain/dates.mjs";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { concertMapVisibleFor } from "../../profilePreferences.js";
import { safeOwnedReadyMediaUrl } from "../../publicMedia.js";
import { trustedCityVenues } from "../cities/citySchema.js";
import { createConcertHistoryLocationResolver, EMPTY_CONCERT_LOCATION } from "./concertHistoryLocation.js";

const PAGE_LIMIT = 200;
const TEN_MINUTES = 10 * 60 * 1000;
const text = (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "";

function readCursor(value, targetId, ApiError) {
  if (value == null || value === "") return null;
  const invalid = () => new ApiError(400, "That concert history page expired. Refresh the profile.", "VALIDATION_FAILED");
  if (typeof value !== "string" || value.length > 600 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid();
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw invalid(); }
  if (cursor?.v !== 1 || cursor.targetId !== targetId || !Number.isSafeInteger(cursor.createdAt)
    || cursor.createdAt < 0 || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200) throw invalid();
  return cursor;
}

function pageLimit(value, ApiError) {
  if (value == null || value === "") return PAGE_LIMIT;
  if (!/^[0-9]+$/u.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new ApiError(400, "Choose a valid concert history page size.", "VALIDATION_FAILED");
  }
  return Math.min(PAGE_LIMIT, Number(value));
}

export function concertHistoryRoutes({
  database, ApiError, visibleProfileOrNull, blockedEitherWay, rateLimit,
  now = () => Date.now(), venues = trustedCityVenues(),
  projectPhoto = (row, viewerId) => (viewerId === row.user_id || row.photos_public === 1)
    ? safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: row.photo_candidate, kind: "image" }) : null,
}) {
  if (!database?.prepare || [ApiError, visibleProfileOrNull, blockedEitherWay, rateLimit, now].some((value) => typeof value !== "function")) {
    throw new TypeError("Concert history requires complete boundary dependencies");
  }
  const resolveLocation = createConcertHistoryLocationResolver(venues);
  const query = (cursor) => database.prepare(`SELECT p.id,p.user_id,p.created_at,p.overall,p.photos_public,
      substr(p.artist,1,120) artist,substr(p.venue,1,160) venue,
      substr(p.city,1,240) city,substr(p.date,1,40) date,substr(p.venue_key,1,200) venue_key,
      CASE WHEN json_valid(p.photos) THEN CASE WHEN json_type(p.photos)='array'
        THEN substr(json_extract(p.photos,'$[0]'),1,2048) ELSE NULL END ELSE NULL END photo_candidate
    FROM posts p WHERE p.user_id=? AND p.removed=0 AND ${inPersonReviewSql("p")}
      ${cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : ""}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`);
  const firstPage = query(false);
  const nextPage = query(true);

  return Object.freeze({
    "GET /api/users/:id/concert-history": (ctx) => {
      const targetId = text(ctx.params?.id, 200);
      const viewerId = ctx.user?.id || null;
      // Identical profile audience and two-way block gates to profile posts.
      if (!targetId || (viewerId !== targetId && blockedEitherWay(viewerId, targetId))) {
        throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
      }
      const target = visibleProfileOrNull(targetId, ctx.user);
      if (!target) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
      rateLimit(ctx, "concert-history", 120, TEN_MINUTES);
      const limit = pageLimit(ctx.query?.limit, ApiError);
      const cursor = readCursor(ctx.query?.before, targetId, ApiError);
      const found = cursor
        ? nextPage.all(targetId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
        : firstPage.all(targetId, limit + 1);
      const hasMore = found.length > limit;
      const scanned = found.slice(0, limit);
      const mapVisible = concertMapVisibleFor(target);
      const today = new Date(now()).toISOString().slice(0, 10);
      const concerts = scanned.flatMap((row) => {
        const date = toIsoDate(row.date);
        if (!date || date >= today || !row.artist.trim() || !row.venue.trim()) return [];
        const rating = Number(row.overall);
        const location = mapVisible ? resolveLocation(row) : EMPTY_CONCERT_LOCATION;
        return [{
          id: row.id, postId: row.id, artist: row.artist, venue: row.venue,
          venueKey: row.venue_key || null, city: row.city, date,
          rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null,
          // One bounded authored image candidate, accepted only by the existing
          // verified-ready media guard. No full post/asset hydration or fetching.
          photo: projectPhoto(row, viewerId),
          ...location,
        }];
      });
      const last = scanned.at(-1);
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({
        v: 1, targetId, createdAt: last.created_at, id: last.id,
      })).toString("base64url") : null;
      ctx.setHeader?.("Cache-Control", "no-store");
      return {
        concerts, nextCursor, hasMore, complete: !hasMore, mapVisible,
        coverage: {
          source: "visible_reviews", includesPrivateAttendance: false,
          unmappedCount: mapVisible ? concerts.filter((row) => row.lat === null || row.lng === null).length : null,
        },
      };
    },
  });
}
