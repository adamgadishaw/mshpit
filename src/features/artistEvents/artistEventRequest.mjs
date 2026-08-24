import { clean } from "../../domain/validation.mjs";

const DEFAULT_REVIEW_LIMIT = 30;
const MAX_REVIEW_LIMIT = 50;

const expectedAccountId = (value) => value == null || value === "" ? null : String(value);

function artistQuery({ artistKey = null, name = null } = {}) {
  const key = clean(artistKey, { max: 120 });
  const artistName = clean(name, { max: 120 });
  if (!key && !artistName) throw new TypeError("Artist event archive requires an artist identity");
  const query = [];
  if (key) query.push(`artistKey=${encodeURIComponent(key)}`);
  if (artistName) query.push(`name=${encodeURIComponent(artistName)}`);
  return query;
}

function boundedLimit(value) {
  const requested = Number(value);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, MAX_REVIEW_LIMIT)
    : DEFAULT_REVIEW_LIMIT;
}

export function artistEventArchiveRequest(options = {}) {
  return Object.freeze({
    path: `/api/artists/archive?${artistQuery(options).join("&")}`,
    expectedAccountId: expectedAccountId(options.accountId),
  });
}

export function artistEventReviewsRequest({ showKey = null, tourKey = null, cursor = null, limit = DEFAULT_REVIEW_LIMIT, ...options } = {}) {
  const show = clean(showKey, { max: 1_800 });
  const tour = clean(tourKey, { max: 1_800 });
  if (!!show === !!tour) throw new TypeError("Artist event reviews require exactly one show or tour");
  if (cursor != null && (typeof cursor !== "string" || !cursor.trim())) {
    throw new TypeError("Artist event review cursor is invalid");
  }
  const query = artistQuery(options);
  query.push(`${show ? "showKey" : "tourKey"}=${encodeURIComponent(show || tour)}`);
  if (cursor) query.push(`cursor=${encodeURIComponent(cursor.trim())}`);
  query.push(`limit=${boundedLimit(limit)}`);
  return Object.freeze({
    path: `/api/artists/archive/reviews?${query.join("&")}`,
    expectedAccountId: expectedAccountId(options.accountId),
  });
}

export function artistEventArchiveFromResponse(payload) {
  const archive = payload?.archive;
  if (!archive || !archive.artist || !Array.isArray(archive.topShows) || !Array.isArray(archive.tours)
    || !Array.isArray(archive.shows) || !Array.isArray(archive.upcoming) || !archive.totals
    || typeof archive.truncated !== "boolean") {
    throw new TypeError("Artist event archive response is invalid");
  }
  return archive;
}

export function artistEventReviewsFromResponse(payload) {
  if (!payload || !Array.isArray(payload.reviews) || !Object.prototype.hasOwnProperty.call(payload, "nextCursor")) {
    throw new TypeError("Artist event reviews response is invalid");
  }
  if (payload.nextCursor !== null && (typeof payload.nextCursor !== "string" || !payload.nextCursor)) {
    throw new TypeError("Artist event review cursor response is invalid");
  }
  const total = Number(payload.total);
  if (!Number.isSafeInteger(total) || total < 0) throw new TypeError("Artist event review total is invalid");
  return Object.freeze({ reviews: payload.reviews, nextCursor: payload.nextCursor, total });
}
