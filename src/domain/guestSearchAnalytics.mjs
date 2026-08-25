// Guest search measurement is deliberately aggregate-only. A client may send
// these three categorical fields, but never the search text, an account/device
// identifier, an IP address, a URL, or an exact timestamp.

export const GUEST_SEARCH_RETENTION_DAYS = 90;

export const GUEST_SEARCH_KINDS = Object.freeze([
  "all",
  "artists",
  "venues",
  "people",
  "events",
  "songs",
]);

export const GUEST_SEARCH_RESULT_BUCKETS = Object.freeze([
  "zero",
  "one_to_five",
  "six_to_twenty",
  "over_twenty",
  "unknown",
]);

export const GUEST_SEARCH_OUTCOMES = Object.freeze(["success", "failed"]);

const kindSet = new Set(GUEST_SEARCH_KINDS);
const resultBucketSet = new Set(GUEST_SEARCH_RESULT_BUCKETS);
const outcomeSet = new Set(GUEST_SEARCH_OUTCOMES);

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Guest search analytics requires a valid time.");
  return date;
}

export function guestSearchUtcDay(value = Date.now()) {
  return validDate(value).toISOString().slice(0, 10);
}

// Keeping the current UTC day plus the preceding 89 days is an exact bounded
// 90-day window for day-granularity aggregates.
export function guestSearchRetentionCutoffDay(value = Date.now(), retentionDays = GUEST_SEARCH_RETENTION_DAYS) {
  const days = Number(retentionDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > GUEST_SEARCH_RETENTION_DAYS) {
    throw new TypeError(`Guest search retention must be between 1 and ${GUEST_SEARCH_RETENTION_DAYS} days.`);
  }
  const date = validDate(value);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

export function guestSearchResultBucket(count) {
  const value = Number(count);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  if (value === 0) return "zero";
  if (value <= 5) return "one_to_five";
  if (value <= 20) return "six_to_twenty";
  return "over_twenty";
}

export function sanitizeGuestSearchPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = typeof value.kind === "string" && kindSet.has(value.kind) ? value.kind : null;
  const resultBucket = typeof value.resultBucket === "string" && resultBucketSet.has(value.resultBucket)
    ? value.resultBucket
    : null;
  const outcome = typeof value.outcome === "string" && outcomeSet.has(value.outcome) ? value.outcome : null;
  if (!kind || !resultBucket || !outcome) return null;

  // A failed request has no trustworthy result count. Conversely, a successful
  // request must carry a real count bucket. Reject mismatched combinations so
  // the operator dashboard cannot imply knowledge the client did not have.
  if (outcome === "failed" && resultBucket !== "unknown") return null;
  if (outcome === "success" && resultBucket === "unknown") return null;

  return { kind, resultBucket, outcome };
}
