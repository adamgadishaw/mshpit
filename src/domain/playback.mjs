// What to do when a video lookup does not return a video.
//
// Every one of these outcomes used to collapse to the same thing — `null`, then
// a 30-second preview for the rest of the session, with no second attempt. But
// they are not the same. "This song has no official upload" is a fact that will
// still be true in an hour. "The daily search budget is spent", "the provider
// paused us", "you were rate limited" and "the request timed out" are all
// temporary, and the video is sitting right there.
//
// Treating temporary failures as permanent is the single biggest reason songs
// played as previews when they did not have to.

// The lookup genuinely answered, and the answer will not change soon.
const DEFINITIVE = new Set([
  "confirmed_unavailable", // an admin pinned "no correct video exists"
  "not_found",             // searched, nothing matched
  "unconfigured",          // no API key; retrying cannot help until it is set
]);

// Capacity and transport problems. The song is fine; we could not ask right now.
const TRANSIENT = new Set([
  "search_budget_exhausted",
  "provider_paused",
  "quota_or_forbidden",
  "rate_limited",
  "http_error",
  "timeout",
  "network",
]);

export const RESOLVE_ATTEMPTS = 3;
// Backoff between attempts within a single play. Deliberately short: someone is
// waiting to hear a song, and the preview covers them meanwhile.
export const RESOLVE_BACKOFF_MS = [400, 1400];

// How long an answer is trusted. A real video id is stable, so it is held for a
// long time. A definitive "no" is held long enough to stop hammering. A
// temporary failure is barely cached at all, so the next play tries again
// instead of inheriting a bad minute.
export const CACHE_MS = {
  hit: 30 * 60 * 1000,
  definitive: 10 * 60 * 1000,
  transient: 15 * 1000,
};

/**
 * Classify one lookup result.
 * @param outcome { videoId, status, retryable } from the API, or { error } when
 *   the request itself failed (network, 429, 5xx).
 */
export function classifyResolve(outcome = {}) {
  const { videoId, status, retryable, error } = outcome;

  if (videoId) return { videoId, transient: false, retry: false, cacheMs: CACHE_MS.hit, status: status || "hit" };

  // The request never completed. Anything other than a clear client mistake is
  // worth another go: a 429 here is usually our own rate limiter, not YouTube.
  if (error) {
    const code = Number(error.status || error.code);
    const clientMistake = code >= 400 && code < 500 && code !== 408 && code !== 429;
    return {
      videoId: null,
      transient: !clientMistake,
      retry: !clientMistake,
      cacheMs: clientMistake ? CACHE_MS.definitive : CACHE_MS.transient,
      status: status || (clientMistake ? "rejected" : "network"),
    };
  }

  if (status && DEFINITIVE.has(status)) {
    return { videoId: null, transient: false, retry: false, cacheMs: CACHE_MS.definitive, status };
  }
  if ((status && TRANSIENT.has(status)) || retryable) {
    return { videoId: null, transient: true, retry: true, cacheMs: CACHE_MS.transient, status: status || "transient" };
  }

  // An unrecognised status is treated as temporary. Being wrong that way costs
  // one extra request; being wrong the other way silently downgrades a song.
  return { videoId: null, transient: true, retry: true, cacheMs: CACHE_MS.transient, status: status || "unknown" };
}

export const backoffFor = (attempt) => RESOLVE_BACKOFF_MS[attempt] ?? RESOLVE_BACKOFF_MS[RESOLVE_BACKOFF_MS.length - 1];
