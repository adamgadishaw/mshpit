import { ARTIST_DEATH_WATCH_INTERVAL_MS } from "../../../src/domain/artistDeathWatch.mjs";

export const ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const isDeathWatchProviderFailure = (code) => /^(?:wikidata|musicbrainz)_(?:timeout|network|rate_limited|unavailable|rejected|response)$/u.test(String(code || ""));

// The existing durable scan timestamps carry the previous cooldown through a
// restart. No in-memory failure counter can accidentally restart hourly hammering.
export function deathWatchRetryAt(settings,error,at,{now=Date.now}={}) {
  const previousFailure=isDeathWatchProviderFailure(settings?.lastErrorCode);
  const previousDelay=Number(settings?.nextScanAt)-Number(settings?.lastScanAt);
  const backoff=previousFailure && Number.isFinite(previousDelay) && previousDelay>0
    ? Math.min(ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS,Math.max(ARTIST_DEATH_WATCH_INTERVAL_MS,previousDelay)*2)
    : ARTIST_DEATH_WATCH_INTERVAL_MS;
  const requested=Number(error?.retryAt);
  // Provider deadlines are bounded from response receipt. Apply a defensive
  // bound at error processing time, not the earlier scan evidence timestamp.
  const processedAt=Number(now());
  const deadlineBase=Number.isSafeInteger(processedAt) && processedAt>=at ? processedAt : at;
  const providerDeadline=Number.isSafeInteger(requested) && requested>at
    ? Math.min(deadlineBase+ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS,requested) : 0;
  return Math.max(at+backoff,providerDeadline);
}
