export const CONCERT_HISTORY_PAGE_SIZE = 200;
const text = (value) => typeof value === "string" ? value.trim() : "";

export function concertHistoryRequest({ accountId = null, targetId, before = null } = {}) {
  const target = text(targetId);
  if (!target || target.length > 160) throw new TypeError("A profile is required.");
  if (before !== null && (!text(before) || before.length > 1024)) throw new TypeError("Invalid history cursor.");
  return {
    path: `/api/users/${encodeURIComponent(target)}/concert-history?limit=${CONCERT_HISTORY_PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
    expectedAccountId: text(accountId) || null,
  };
}

export function withoutConcertLocation(row) {
  return { ...row, lat: null, lng: null, country: null, countryCode: null, locationPrecision: null };
}

export function concertHistoryResponse(payload) {
  if (!payload || !Array.isArray(payload.concerts) || payload.concerts.length > CONCERT_HISTORY_PAGE_SIZE
    || typeof payload.mapVisible !== "boolean" || typeof payload.complete !== "boolean"
    || typeof payload.hasMore !== "boolean"
    || !(payload.nextCursor === null || typeof payload.nextCursor === "string" && payload.nextCursor.length > 0 && payload.nextCursor.length <= 1024)
    || payload.hasMore !== !!payload.nextCursor || payload.complete === payload.hasMore) {
    throw new TypeError("Concert history was not returned correctly.");
  }
  const concerts = payload.concerts.map((row) => {
    if (!row || !text(row.id) || !text(row.postId) || !text(row.artist) || !text(row.venue)
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new TypeError("Invalid concert history row.");
    const safe = {
      id: row.id, postId: row.postId, artist: row.artist, venue: row.venue,
      venueKey: text(row.venueKey), city: text(row.city), date: row.date,
      rating: typeof row.rating === "number" && Number.isFinite(row.rating) ? row.rating : null,
      photo: typeof row.photo === "string" ? row.photo : null,
      lat: row.lat, lng: row.lng, country: text(row.country), countryCode: text(row.countryCode),
      locationPrecision: row.locationPrecision || null,
    };
    const located = typeof safe.lat === "number" && typeof safe.lng === "number"
      && Number.isFinite(safe.lat) && Number.isFinite(safe.lng)
      && Math.abs(safe.lat) <= 90 && Math.abs(safe.lng) <= 180;
    return payload.mapVisible && located ? safe : withoutConcertLocation(safe);
  });
  return { concerts, nextCursor: payload.nextCursor, complete: payload.complete, mapVisible: payload.mapVisible };
}
