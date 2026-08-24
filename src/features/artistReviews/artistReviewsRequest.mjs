import { clean } from "../../domain/validation.mjs";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

const boundedLimit = (value) => {
  const requested = Number(value);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, MAX_LIMIT)
    : DEFAULT_LIMIT;
};

const expectedAccountId = (value) => value == null || value === ""
  ? null
  : String(value);

export function artistReviewsRequest({ artistKey = null, name = null, limit = DEFAULT_LIMIT, accountId = null } = {}) {
  const key = clean(artistKey, { max: 120 });
  const artistName = clean(name, { max: 120 });
  if (!key && !artistName) throw new TypeError("Artist reviews require an artist identity");

  const query = [];
  if (key) query.push(`artistKey=${encodeURIComponent(key)}`);
  if (artistName) query.push(`name=${encodeURIComponent(artistName)}`);
  query.push(`limit=${boundedLimit(limit)}`);

  return Object.freeze({
    path: `/api/artists/reviews?${query.join("&")}`,
    expectedAccountId: expectedAccountId(accountId),
  });
}

export function artistReviewsFromResponse(payload) {
  if (!payload || !Array.isArray(payload.reviews)) {
    throw new TypeError("Artist reviews response is invalid");
  }
  return payload.reviews;
}
