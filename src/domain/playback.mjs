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
  "search_login_required",        // preview is available; signing in unlocks cold search
  "search_verification_required", // account must be verified before it can spend shared quota
  "search_actor_budget_exhausted", // this actor's bounded daily allowance is spent
]);

// A safe GET exhausted pins, cache and artist catalogues. This is not a failed
// song lookup: the client deliberately stopped before the quota-spending POST.
// A later, explicit "Find full track" action may cross that boundary once.
const DEFERRED = "search_deferred";

// Capacity and transport problems. The song is fine; we could not ask right now.
const TRANSIENT = new Set([
  "search_budget_exhausted",
  "provider_paused",
  "quota_or_forbidden",
  "rate_limited",
  "http_error",
  "resolution_timeout",
  "timeout",
  "network",
]);

const LOOKUP_NOTICES = Object.freeze({
  search_deferred: Object.freeze({
    kind: "catalogue_only",
    message: "Previewing without spending a YouTube search.",
  }),
  search_login_required: Object.freeze({
    kind: "sign_in",
    message: "Sign in for full-track YouTube lookup.",
  }),
  search_verification_required: Object.freeze({
    kind: "verify_email",
    message: "Verify your email for full-track YouTube lookup.",
  }),
  search_actor_budget_exhausted: Object.freeze({
    kind: "account_limit",
    message: "Your YouTube search allowance is used for now. Try again later.",
  }),
  unconfigured: Object.freeze({
    kind: "configuration",
    message: "Full-track YouTube lookup is unavailable right now.",
  }),
  search_budget_exhausted: Object.freeze({
    kind: "global_limit",
    message: "PIT's shared YouTube search allowance is used for now.",
  }),
  provider_paused: Object.freeze({
    kind: "provider_unavailable",
    message: "YouTube full-track lookup is temporarily paused.",
  }),
  quota_or_forbidden: Object.freeze({
    kind: "provider_unavailable",
    message: "YouTube full-track lookup is temporarily unavailable.",
  }),
});

const TEMPORARY_LOOKUP_NOTICE = Object.freeze({
  kind: "temporary",
  message: "YouTube lookup is temporarily busy. Try again shortly.",
});

// How long an answer is trusted. A real video id is stable, so it is held for a
// long time. A definitive "no" is held long enough to stop hammering. A
// temporary failure is barely cached at all, so the next play tries again
// instead of inheriting a bad minute.
export const CACHE_MS = {
  hit: 30 * 60 * 1000,
  definitive: 10 * 60 * 1000,
  transient: 15 * 1000,
  deferred: 15 * 1000,
};

// Empty playback results can mean either "this recording was not found" or
// "the listener/provider cannot perform a cold search right now". Keep that
// policy distinction pure so PlayerBar can show an actionable state without
// misreporting an access/capacity decision as a broken song.
export function playerYouTubeLookupNotice(status) {
  const normalized = typeof status === "string" ? status.trim() : "";
  if (!normalized) return null;
  return LOOKUP_NOTICES[normalized] || (TRANSIENT.has(normalized) ? TEMPORARY_LOOKUP_NOTICE : null);
}

// Keep the reason visible even while the fallback is successfully playing.
// Previously the UI only showed this copy when *no* source was playable, which
// made verification, account and provider limits look like an ordinary preview.
export function playerYouTubeStatusMessage(notice, { preview = false } = {}) {
  const message = typeof notice?.message === "string" ? notice.message.trim() : "";
  if (!message) return null;
  return preview && notice?.kind !== "catalogue_only" ? `${message} Preview playing.` : message;
}

function cleanOccurrenceId(track) {
  return typeof track?.queueEntryId === "string" ? track.queueEntryId.trim().slice(0, 120) : "";
}

// The search decision belongs to a queue occurrence, never an array index or a
// recording. That keeps duplicate tracks independent and survives queue reorders.
export function playerLookupIntent(track, trigger = "explicit") {
  const occurrenceId = cleanOccurrenceId(track);
  const explicit = trigger === "explicit";
  return {
    occurrenceId,
    trigger: explicit ? "explicit" : "automatic",
    coldSearchAllowed: explicit,
  };
}

export function playerColdSearchAllowed(track, intent) {
  const occurrenceId = cleanOccurrenceId(track);
  return !!occurrenceId
    && intent?.occurrenceId === occurrenceId
    && intent?.trigger === "explicit"
    && intent?.coldSearchAllowed === true;
}

// One provider resolution occurrence performs one safe read and, only after an
// explicit listener action, at most one quota-spending mutation. There is no
// hidden transport/capacity retry here; the caller may expose another explicit
// action after this occurrence settles.
export async function requestYouTubeTrackOnce({
  request,
  title,
  artist = "",
  duration = 0,
  provider = "",
  sourceId = "",
  excludedVideoIds = [],
  allowSearch = false,
  signal,
} = {}) {
  if (typeof request !== "function" || !title) return { videoId: null, status: "invalid_request", retryable: false };

  const query = new URLSearchParams({ title, artist: artist || "" });
  const coldSearchBody = { title, artist: artist || "" };
  if (Number(duration) > 0) {
    const roundedDuration = Math.round(Number(duration));
    query.set("duration", String(roundedDuration));
    coldSearchBody.duration = roundedDuration;
  }
  if (provider) {
    query.set("provider", String(provider));
    coldSearchBody.provider = String(provider);
  }
  if (sourceId != null && String(sourceId).trim()) {
    query.set("sourceId", String(sourceId));
    coldSearchBody.sourceId = String(sourceId);
  }
  const excluded = Array.isArray(excludedVideoIds) ? excludedVideoIds.filter(Boolean) : [];
  if (excluded.length) {
    query.set("exclude", excluded.join(","));
    coldSearchBody.exclude = excluded.join(",");
  }

  let response = await request(
    `/api/youtube/track?${query.toString()}`,
    signal ? { signal } : undefined,
  );
  if (response?.status === DEFERRED && allowSearch) {
    response = await request("/api/youtube/track/resolve", {
      method: "POST",
      body: coldSearchBody,
      context: "Finding the full track",
      silent: true,
      signal,
    });
  }
  return response;
}

// A ref-backed cache does not trigger React renders by itself. PlayerBar reads
// this immediately when its resolver promise settles. Never expose an expired or
// malformed entry, and let the store's account-scoped cache key own isolation.
export function activeYouTubeLookupStatus(entry, now = Date.now()) {
  if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) return null;
  const status = typeof entry.status === "string" ? entry.status.trim() : "";
  return status || null;
}

/**
 * Classify one lookup result.
 * @param outcome { videoId, status, retryable } from the API, or { error } when
 *   the request itself failed (network, 429, 5xx).
 */
export function classifyResolve(outcome = {}) {
  const { videoId, status, retryable, error } = outcome;

  if (videoId) return { videoId, transient: false, retry: false, cacheMs: CACHE_MS.hit, status: status || "hit" };

  // The request never completed. Preserve whether the result is temporary, but
  // never automatically replay a quota-capable occurrence.
  if (error) {
    const code = Number(error.status || error.code);
    const clientMistake = code >= 400 && code < 500 && code !== 408 && code !== 429;
    return {
      videoId: null,
      transient: !clientMistake,
      retry: false,
      cacheMs: clientMistake ? CACHE_MS.definitive : CACHE_MS.transient,
      status: status || (clientMistake ? "rejected" : "network"),
    };
  }

  if (status === DEFERRED) {
    return { videoId: null, transient: false, retry: false, cacheMs: CACHE_MS.deferred, status };
  }

  if (status && DEFINITIVE.has(status)) {
    return { videoId: null, transient: false, retry: false, cacheMs: CACHE_MS.definitive, status };
  }
  // An explicit `retryable: false` is an authoritative server decision. Unknown
  // or temporary answers expire sooner, but none re-run inside this occurrence.
  if (retryable === false) {
    return { videoId: null, transient: false, retry: false, cacheMs: CACHE_MS.definitive, status: status || "rejected" };
  }
  if ((status && TRANSIENT.has(status)) || retryable) {
    return { videoId: null, transient: true, retry: false, cacheMs: CACHE_MS.transient, status: status || "transient" };
  }

  // Unknown answers expire quickly, but still require another listener action.
  return { videoId: null, transient: true, retry: false, cacheMs: CACHE_MS.transient, status: status || "unknown" };
}

// Catalogue-only cache entries suppress repeated safe reads during automatic
// playback, but must yield when the listener explicitly opts into one search.
export function shouldUseYouTubeLookupCache(entry, { allowSearch = false, now = Date.now() } = {}) {
  return !!entry
    && Number.isFinite(entry.expiresAt)
    && entry.expiresAt > now
    && !(allowSearch && entry.status === DEFERRED);
}
