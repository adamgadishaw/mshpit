import { ApiError } from "../../errors.js";
import { isStrictCalendarDate } from "./publicEntityPolicy.js";

// A cursor is a bounded position, not authority. Every page resolves its venue
// and re-applies the public event predicates. Bind it to the canonical venue.
export function publicVenueEventCursor(after, canonicalPath) {
  if (after == null || after === "") return null;
  const invalid = () => new ApiError(400, "Choose a valid venue event page.", "VALIDATION_FAILED");
  if (typeof after !== "string" || after.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(after)) throw invalid();
  let value;
  try { value = JSON.parse(Buffer.from(after, "base64url").toString("utf8")); }
  catch { throw invalid(); }
  if (value?.path !== canonicalPath || !isStrictCalendarDate(value.date)
    || typeof value.id !== "string" || !value.id || value.id.length > 180
    || /[\u0000-\u001f\u007f]/.test(value.id)) throw invalid();
  return { date: value.date, id: value.id };
}

export function projectPublicVenueSnapshot(raw, document, { canonicalPath, after = null }) {
  if (!raw || !document) return null;
  const last = raw.events.at(-1);
  const hasMore = raw.eventsHasMore === true && !!last;
  return {
    path: canonicalPath,
    venue: {
      name: document.venue.name, source: raw.venue.source, providerVenueId: raw.venue.providerVenueId,
      place: document.venue.place, address: document.venue.address,
      coord: document.venue.coord, capacity: document.venue.capacity,
    },
    // These cards are already the SSR allow-list. No raw rows, member reviews,
    // account identifiers, moderation state, or draft catalog text leave here.
    events: document.events,
    hasMore,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ path: canonicalPath, date: last.date, id: last.id })).toString("base64url") : null,
    after: after || null,
  };
}

export function publicVenueSnapshotRoutes({ rateLimit, readSnapshot }) {
  return {
    "GET /api/venue-snapshot": (ctx) => {
      rateLimit(ctx, "public-venue-snapshot", 120, 10 * 60 * 1000);
      const { path, after = null } = ctx.query || {};
      if (typeof path !== "string" || path.length > 500 || !/^\/venue\/[a-z0-9-]+\/?$/.test(path)
        || (after != null && (typeof after !== "string" || after.length > 1024))) {
        throw new ApiError(400, "Choose a valid venue page.", "VALIDATION_FAILED");
      }
      ctx.setHeader?.("Cache-Control", "no-store");
      const snapshot = readSnapshot(path, after);
      if (!snapshot) throw new ApiError(404, "This venue is unavailable.", "NOT_FOUND");
      return snapshot;
    },
  };
}
